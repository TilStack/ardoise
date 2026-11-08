import 'package:path/path.dart' as p;
import 'package:sqflite/sqflite.dart';

/// Base locale : miroir des clients (dernier état serveur connu) + file d'attente des saisies hors-ligne.
///
/// La file d'attente (outbox) est la source de vérité des saisies non synchronisées :
/// une ligne n'est supprimée qu'une fois confirmée par le serveur (CREATED ou DUPLICATE).
class LocalDb {
  LocalDb(this.db);
  final Database db;

  static const _schema = [
    '''CREATE TABLE customers(
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      operator TEXT,
      server_balance INTEGER NOT NULL DEFAULT 0,
      last_activity_at TEXT,
      days_late INTEGER NOT NULL DEFAULT 0,
      synced INTEGER NOT NULL DEFAULT 1
    )''',
    '''CREATE TABLE outbox(
      client_uuid TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      type TEXT NOT NULL,
      amount INTEGER NOT NULL,
      label TEXT,
      occurred_at TEXT NOT NULL,
      error TEXT
    )''',
    'CREATE TABLE kv(k TEXT PRIMARY KEY, v TEXT)',
  ];

  static Future<LocalDb> open({
    String name = 'ardoise.db',
    DatabaseFactory? factory,
  }) async {
    final f = factory ?? databaseFactory;
    final path = name == inMemoryDatabasePath
        ? name
        : p.join(await f.getDatabasesPath(), name);
    final db = await f.openDatabase(
      path,
      options: OpenDatabaseOptions(
        version: 1,
        // Une base en mémoire doit être neuve à chaque ouverture (tests) ; sqflite les partage sinon.
        singleInstance: path != inMemoryDatabasePath,
        onCreate: (db, _) async {
          for (final s in _schema) {
            await db.execute(s);
          }
        },
      ),
    );
    return LocalDb(db);
  }

  // ---- Clients ----

  Future<List<Map<String, Object?>>> customers() =>
      db.query('customers', orderBy: 'name COLLATE NOCASE');

  Future<void> upsertCustomer(Map<String, Object?> row) =>
      db.insert('customers', row, conflictAlgorithm: ConflictAlgorithm.replace);

  /// Remplace le miroir par l'état serveur, sans perdre les clients créés hors-ligne non encore envoyés.
  Future<void> replaceServerCustomers(List<Map<String, Object?>> rows) async {
    await db.transaction((t) async {
      await t.delete('customers', where: 'synced = 1');
      final batch = t.batch();
      for (final r in rows) {
        batch.insert('customers', {
          ...r,
          'synced': 1,
        }, conflictAlgorithm: ConflictAlgorithm.replace);
      }
      await batch.commit(noResult: true);
    });
  }

  Future<List<Map<String, Object?>>> unsyncedCustomers() =>
      db.query('customers', where: 'synced = 0');

  Future<void> markCustomerSynced(String id) =>
      db.update('customers', {'synced': 1}, where: 'id = ?', whereArgs: [id]);

  // ---- File d'attente ----

  Future<void> enqueue(Map<String, Object?> entry) =>
      db.insert('outbox', entry, conflictAlgorithm: ConflictAlgorithm.ignore);

  Future<List<Map<String, Object?>>> pending() =>
      db.query('outbox', orderBy: 'occurred_at');

  Future<void> dequeue(List<String> clientUuids) async {
    if (clientUuids.isEmpty) return;
    await db.delete(
      'outbox',
      where:
          'client_uuid IN (${List.filled(clientUuids.length, '?').join(',')})',
      whereArgs: clientUuids,
    );
  }

  Future<void> markRejected(String clientUuid, String error) => db.update(
    'outbox',
    {'error': error},
    where: 'client_uuid = ?',
    whereArgs: [clientUuid],
  );

  // ---- Clé / valeur (nom de boutique, dernier tableau de bord…) ----

  Future<String?> get(String k) async {
    final r = await db.query('kv', where: 'k = ?', whereArgs: [k]);
    return r.isEmpty ? null : r.first['v'] as String?;
  }

  Future<void> set(String k, String? v) => db.insert('kv', {
    'k': k,
    'v': v,
  }, conflictAlgorithm: ConflictAlgorithm.replace);

  Future<void> clearAll() async {
    await db.delete('customers');
    await db.delete('outbox');
    // Le thème est une préférence de l'appareil : il survit à la déconnexion.
    await db.delete('kv', where: 'k != ?', whereArgs: ['theme_mode']);
  }
}
