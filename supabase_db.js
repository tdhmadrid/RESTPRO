// ══════════════════════════════════════════════════════════════════
// RestaurantePRO — Capa de datos Supabase
// Reemplaza IndexedDB. Mantiene la misma API: dbGetAll, dbAdd, dbPut, dbDelete
// ══════════════════════════════════════════════════════════════════
// INSTRUCCIONES:
// 1. Reemplazar SUPABASE_URL y SUPABASE_ANON_KEY con los valores
//    de tu proyecto en supabase.com → Settings → API
// 2. Incluir en el HTML ANTES del script principal:
//    <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
//    <script src="supabase_db.js"></script>
// ══════════════════════════════════════════════════════════════════

const SUPABASE_URL  = 'https://iwrzwtokmfimjdzzckhh.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml3cnp3dG9rbWZpbWpkenpja2hoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM5MzcwNTgsImV4cCI6MjA4OTUxMzA1OH0.B3AuVsilyWVW05HTvE2_FBI-ANvex4_88DYFQSki_uA';

// Cliente Supabase global
const _sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

// Usuario actual en memoria
let _currentUser = null;

// ── MAPEO: nombre del store IndexedDB → tabla Supabase ──────────
// La lógica del HTML usa los nombres de store originales
const STORE_TABLE = {
  productos:              'productos',
  preparaciones:          'preparaciones',
  recetas:                'recetas',
  compras:                'compras',
  movimientos_inventario: 'movimientos_inventario',
  ventas_consolidadas:    'ventas_consolidadas',
  proveedores:            'proveedores',
  empleados:              'empleados',
  pagos_empleados:        'pagos_empleados',
  turnos_empleados:       'turnos_empleados',
  plantillas_turno:       'plantillas_turno',
  contratos_gasto:        'contratos_gasto',
  facturas_gasto:         'facturas_gasto',
  configuracion:          'configuracion',  // especial — una fila por usuario
};

// ── AUTH ─────────────────────────────────────────────────────────

async function authSignIn(email, password) {
  const { data, error } = await _sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
  _currentUser = data.user;
  return data.user;
}

async function authSignUp(email, password) {
  const { data, error } = await _sb.auth.signUp({ email, password });
  if (error) throw new Error(error.message);
  return data.user;
}

async function authSignOut() {
  await _sb.auth.signOut();
  _currentUser = null;
}

async function authGetSession() {
  const { data } = await _sb.auth.getSession();
  if (data?.session?.user) {
    _currentUser = data.session.user;
    return data.session.user;
  }
  return null;
}

function authUserId() {
  if (!_currentUser) throw new Error('No hay sesión activa');
  return _currentUser.id;
}

// ── CRUD — Reemplazo directo de las funciones IndexedDB ──────────

// Equivale a: dbGetAll('productos') → todos los registros del usuario
async function dbGetAll(storeName) {
  const table = STORE_TABLE[storeName];
  if (!table) throw new Error(`Store desconocido: ${storeName}`);

  if (storeName === 'configuracion') {
    return _getConfig();
  }

  const { data, error } = await _sb
    .from(table)
    .select('*')
    .eq('user_id', authUserId())
    .order('id');

  if (error) throw new Error(`dbGetAll(${storeName}): ${error.message}`);
  return data || [];
}

// Equivale a: dbAdd('productos', {...}) → inserta y devuelve el nuevo ID
async function dbAdd(storeName, record) {
  const table = STORE_TABLE[storeName];
  if (!table) throw new Error(`Store desconocido: ${storeName}`);

  if (storeName === 'configuracion') {
    return _upsertConfig(record);
  }

  // Eliminar el 'id' si es 0 o null para que Supabase lo genere
  const toInsert = { ...record, user_id: authUserId() };
  delete toInsert.id;

  const { data, error } = await _sb
    .from(table)
    .insert(toInsert)
    .select('id')
    .single();

  if (error) throw new Error(`dbAdd(${storeName}): ${error.message}`);
  return data.id;
}

// Equivale a: dbPut('productos', {...}) → upsert (inserta o actualiza)
async function dbPut(storeName, record) {
  const table = STORE_TABLE[storeName];
  if (!table) throw new Error(`Store desconocido: ${storeName}`);

  if (storeName === 'configuracion') {
    return _upsertConfig(record);
  }

  const toUpsert = { ...record, user_id: authUserId() };

  const { data, error } = await _sb
    .from(table)
    .upsert(toUpsert, { onConflict: 'id' })
    .select('id')
    .single();

  if (error) throw new Error(`dbPut(${storeName}): ${error.message}`);
  return data?.id;
}

// Equivale a: dbDelete('productos', 5) → borra por ID
async function dbDelete(storeName, id) {
  const table = STORE_TABLE[storeName];
  if (!table) throw new Error(`Store desconocido: ${storeName}`);

  const { error } = await _sb
    .from(table)
    .delete()
    .eq('id', id)
    .eq('user_id', authUserId());

  if (error) throw new Error(`dbDelete(${storeName}): ${error.message}`);
}

// dbClear — borra todos los registros del usuario para un store
async function dbClear(storeName) {
  const table = STORE_TABLE[storeName];
  if (!table) return;

  const { error } = await _sb
    .from(table)
    .delete()
    .eq('user_id', authUserId());

  if (error) throw new Error(`dbClear(${storeName}): ${error.message}`);
}

// ── CONFIGURACIÓN — manejo especial ─────────────────────────────
// En Supabase es una sola fila por usuario en lugar del modelo key/value de IndexedDB
// cargarTodo() llama dbGetAll('configuracion') y espera [{key, value}]
// Devolvemos el mismo formato para compatibilidad

async function _getConfig() {
  const { data, error } = await _sb
    .from('configuracion')
    .select('*')
    .eq('user_id', authUserId())
    .maybeSingle();

  if (error) throw new Error(`getConfig: ${error.message}`);

  if (!data) return [];  // Sin configuración aún

  // Convertir la fila plana al formato [{key, value}] que espera cargarTodo
  const { id, user_id, actualizado, ...fields } = data;
  return Object.entries(fields).map(([key, value]) => ({ key, value }));
}

async function _upsertConfig(record) {
  // record puede ser {key: 'nombre', value: 'Mi Restaurante'} (formato IndexedDB)
  // o directamente el objeto config completo
  const uid = authUserId();

  // Obtener config actual
  const { data: existing } = await _sb
    .from('configuracion')
    .select('id')
    .eq('user_id', uid)
    .maybeSingle();

  let configRow;
  if (record.key !== undefined) {
    // Formato IndexedDB: {key, value}
    if (existing) {
      configRow = { id: existing.id, user_id: uid, [record.key]: record.value };
    } else {
      configRow = { user_id: uid, [record.key]: record.value };
    }
  } else {
    // Objeto config completo
    configRow = { ...record, user_id: uid };
    if (existing) configRow.id = existing.id;
  }

  const { error } = await _sb
    .from('configuracion')
    .upsert(configRow, { onConflict: 'id' });

  if (error) throw new Error(`upsertConfig: ${error.message}`);
}

// Guarda toda la config de una vez (llamado desde guardarConfiguracion())
async function guardarConfiguracionSupabase(configObj) {
  const uid = authUserId();
  const { id: _id, ...fields } = configObj;

  const { data: existing } = await _sb
    .from('configuracion')
    .select('id')
    .eq('user_id', uid)
    .maybeSingle();

  const row = { ...fields, user_id: uid };
  if (existing) row.id = existing.id;

  const { error } = await _sb
    .from('configuracion')
    .upsert(row, { onConflict: 'id' });

  if (error) throw new Error(`guardarConfiguracion: ${error.message}`);
}

// ── IMPORTAR BACKUP ──────────────────────────────────────────────
// Sube todos los datos de un backup.json a Supabase (borra y recrea)
async function importarBackupASupabase(backupStores) {
  const STORES_ORDER = [
    'configuracion', 'productos', 'preparaciones', 'recetas',
    'proveedores', 'compras', 'movimientos_inventario', 'ventas_consolidadas',
    'empleados', 'pagos_empleados', 'turnos_empleados', 'plantillas_turno',
    'contratos_gasto', 'facturas_gasto'
  ];

  const uid = authUserId();
  let total = 0;

  for (const storeName of STORES_ORDER) {
    const items = backupStores[storeName] || [];
    await dbClear(storeName);

    if (!items.length) continue;

    if (storeName === 'configuracion') {
      // Convertir formato [{key,value}] a objeto plano
      const configObj = { user_id: uid };
      items.forEach(({ key, value }) => { configObj[key] = value; });
      const { error } = await _sb.from('configuracion').insert(configObj);
      if (error) console.error('config import:', error.message);
      else total++;
      continue;
    }

    // Quitar 'id' para que Supabase reasigne (evita conflictos de secuencia)
    // y añadir user_id
    // NOTA: los foreign keys (producto_id, emp_id, etc.) pueden no coincidir
    // si los IDs cambian. Para preservar IDs usar setval() en PostgreSQL.
    const rows = items.map(item => {
      const { id: _id, ...rest } = item;
      return { ...rest, user_id: uid };
    });

    // Insert en batches de 100
    for (let i = 0; i < rows.length; i += 100) {
      const batch = rows.slice(i, i + 100);
      const { error } = await _sb.from(STORE_TABLE[storeName]).insert(batch);
      if (error) console.error(`import ${storeName}:`, error.message);
      else total += batch.length;
    }
  }
  return total;
}

// ── initDB — stub para compatibilidad ────────────────────────────
// En el HTML original, init() llama initDB(). Lo reemplazamos por authGetSession()
async function initDB() {
  // No-op — Supabase no necesita inicialización de schema
  // La sesión se maneja en authGetSession()
  return true;
}

// ── EXPORTAR para uso global ──────────────────────────────────────
// Estas funciones ya son globales en el contexto del navegador
// No hace falta export si se usa en un <script> normal (no módulo)
