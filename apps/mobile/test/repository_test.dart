import 'dart:io';

import 'package:ardoise/core/api_client.dart';
import 'package:ardoise/core/money.dart';
import 'package:ardoise/data/local_db.dart';
import 'package:ardoise/data/repository.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

/// Faux serveur en mémoire, fidèle aux règles de l'API (idempotence par clientUuid, client par numéro).
class FakeApi extends ApiClient {
  FakeApi() : super(baseUrl: 'http://fake');
  bool offline = false;
  final serverCustomers = <String, Map<String, dynamic>>{};
  final serverEntries = <String, Map<String, dynamic>>{};
  int syncCalls = 0;

  void _net() {
    if (offline) throw ApiException('Pas de connexion internet');
  }

  int _balance(String id) => serverEntries.values
      .where((e) => e['customerId'] == id)
      .fold(
        0,
        (t, e) =>
            t +
            (e['type'] == 'DEBT' ? e['amount'] as int : -(e['amount'] as int)),
      );

  @override
  Future<Map<String, dynamic>> createCustomer({
    required String clientUuid,
    required String name,
    required String phone,
  }) async {
    _net();
    final existing = serverCustomers.values
        .where((c) => c['phone'] == phone)
        .firstOrNull;
    if (existing != null) return existing;
    return serverCustomers[clientUuid] = {
      'id': clientUuid,
      'name': name,
      'phone': phone,
      'operator': 'MTN',
    };
  }

  @override
  Future<Map<String, dynamic>> syncEntries(
    List<Map<String, dynamic>> entries,
  ) async {
    _net();
    syncCalls++;
    final results = <Map<String, dynamic>>[];
    for (final e in entries) {
      final id = e['clientUuid'] as String;
      if (!serverCustomers.containsKey(e['customerId'])) {
        results.add({
          'clientUuid': id,
          'status': 'REJECTED',
          'error': 'Client introuvable',
        });
      } else if (serverEntries.containsKey(id)) {
        results.add({'clientUuid': id, 'status': 'DUPLICATE'});
      } else {
        serverEntries[id] = e;
        results.add({'clientUuid': id, 'status': 'CREATED'});
      }
    }
    return {'results': results};
  }

  @override
  Future<Map<String, dynamic>> customers() async {
    _net();
    return {
      'customers': serverCustomers.values
          .map(
            (c) => {
              ...c,
              'balance': _balance(c['id'] as String),
              'daysLate': 0,
              'lastActivityAt': null,
            },
          )
          .toList(),
    };
  }

  @override
  Future<Map<String, dynamic>> dashboard() async {
    _net();
    return {
      'totalOwed': 0,
      'collectedThisMonth': 0,
      'inTransit': 0,
      'lateCount': 0,
    };
  }
}

void main() {
  sqfliteFfiInit();
  late FakeApi api;
  late ArdoiseRepository repo;

  setUp(() async {
    api = FakeApi();
    final db = await LocalDb.open(
      name: inMemoryDatabasePath,
      factory: databaseFactoryFfiNoIsolate,
    );
    repo = ArdoiseRepository(api, db);
    await repo.load();
  });

  test(
    'saisie hors-ligne : solde mis à jour tout de suite, envoyée une seule fois au retour du réseau',
    () async {
      api.offline = true;
      final paul = await repo.addCustomer('Paul Ngono', '+237677123456');
      await repo.addEntry(
        customerId: paul.id,
        kind: EntryKind.debt,
        amount: 5000,
        label: 'Riz',
      );
      await repo.addEntry(
        customerId: paul.id,
        kind: EntryKind.cash,
        amount: 2000,
      );
      await repo.sync();

      expect(repo.online, isFalse);
      expect(repo.pendingCount, 2);
      expect(repo.byId(paul.id)!.balance, 3000);
      expect(repo.totalOwed, 3000);
      expect(api.serverEntries, isEmpty);

      api.offline = false;
      await repo.sync();
      expect(repo.online, isTrue);
      expect(repo.pendingCount, 0);
      expect(api.serverEntries, hasLength(2));
      expect(
        repo.byId(paul.id)!.serverBalance,
        3000,
      ); // le solde vient désormais du serveur
      expect(repo.byId(paul.id)!.pendingDelta, 0);

      await repo.sync();
      expect(
        api.serverEntries,
        hasLength(2),
        reason: 'une nouvelle synchro ne doit rien renvoyer',
      );
    },
  );

  test(
    'coupure pendant la réponse : le rejeu est sans doublon grâce à l’UUID',
    () async {
      final paul = await repo.addCustomer('Paul', '+237677123456');
      await repo.sync();
      api.offline = true;
      await repo.addEntry(
        customerId: paul.id,
        kind: EntryKind.debt,
        amount: 1500,
      );
      // Le serveur a reçu la saisie mais la réponse s'est perdue : on simule en l'insérant côté serveur.
      final pending = await repo.db.pending();
      api.serverEntries[pending.first['client_uuid'] as String] = {
        'clientUuid': pending.first['client_uuid'],
        'customerId': paul.id,
        'type': 'DEBT',
        'amount': 1500,
      };
      api.offline = false;
      await repo.sync();
      expect(api.serverEntries, hasLength(1));
      expect(repo.byId(paul.id)!.balance, 1500);
      expect(repo.pendingCount, 0);
    },
  );

  test(
    'client créé hors-ligne déjà connu du serveur : les saisies sont rattachées au bon client',
    () async {
      api.serverCustomers['srv-1'] = {
        'id': 'srv-1',
        'name': 'Paul Ngono',
        'phone': '+237677123456',
        'operator': 'MTN',
      };
      api.offline = true;
      final local = await repo.addCustomer('Paul N.', '+237677123456');
      await repo.addEntry(
        customerId: local.id,
        kind: EntryKind.debt,
        amount: 700,
      );
      api.offline = false;
      await repo.sync();
      expect(repo.customers, hasLength(1));
      expect(repo.customers.single.id, 'srv-1');
      expect(repo.customers.single.balance, 700);
      expect(api.serverEntries.values.single['customerId'], 'srv-1');
    },
  );

  test(
    'une saisie rejetée par le serveur reste visible en file mais ne fausse plus le solde',
    () async {
      final paul = await repo.addCustomer('Paul', '+237677123456');
      await repo.sync();
      await repo.db.enqueue({
        'client_uuid': 'x-1',
        'customer_id': 'inconnu',
        'type': 'DEBT',
        'amount': 999,
        'occurred_at': DateTime.now().toIso8601String(),
      });
      await repo.sync();
      final rows = await repo.db.pending();
      expect(rows.single['error'], 'Client introuvable');
      expect(repo.byId(paul.id)!.balance, 0);
    },
  );

  test('refuse les montants invalides', () async {
    final paul = await repo.addCustomer('Paul', '+237677123456');
    expect(
      () => repo.addEntry(customerId: paul.id, kind: EntryKind.debt, amount: 0),
      throwsArgumentError,
    );
    expect(
      () => repo.addEntry(
        customerId: paul.id,
        kind: EntryKind.debt,
        amount: 20000000,
      ),
      throwsArgumentError,
    );
  });

  group('formatage', () {
    test('montants et numéros', () {
      expect(fcfa(186500), '186 500 FCFA');
      expect(formatAmount(0), '0');
      expect(normalizeCmPhone('6 77 12 34 56'), '+237677123456');
      expect(normalizeCmPhone('+237 699 00 11 22'), '+237699001122');
      expect(normalizeCmPhone('12345'), isNull);
      expect(displayPhone('+237677123456'), '6 77 12 34 56');
      expect(initials('Paul Ngono'), 'PN');
      expect(initials('Junior (taxi)'), 'JT');
      expect(initials('Éric'), 'É');
    });
  });

  // Intégration réelle avec l'API locale : `ARDOISE_API_URL=http://localhost:3000 flutter test`
  final apiUrl = Platform.environment['ARDOISE_API_URL'];
  test(
    'intégration : connexion OTP, saisie hors-ligne puis synchro avec la vraie API',
    () async {
      final real = ApiClient(baseUrl: apiUrl);
      final phone =
          '+2376${DateTime.now().millisecondsSinceEpoch.toString().substring(5)}';
      final otp = await real.requestOtp(phone);
      final auth = await real.verifyOtp(phone, otp['devCode'] as String);
      real.token = auth['token'] as String;
      final db = await LocalDb.open(
        name: inMemoryDatabasePath,
        factory: databaseFactoryFfiNoIsolate,
      );
      final r = ArdoiseRepository(real, db);
      final c = await r.addCustomer('Client Intégration', '+237699112233');
      await r.addEntry(customerId: c.id, kind: EntryKind.debt, amount: 4000);
      await r.addEntry(customerId: c.id, kind: EntryKind.cash, amount: 1500);
      await r.sync();
      await r.sync();
      expect(r.pendingCount, 0);
      final detail = await real.customer(c.id);
      expect(detail['balance'], 2500);
      expect((detail['history'] as List), hasLength(2));
      final link = await r.paymentLink(c.id);
      expect(link['message'], contains('2 500 FCFA'));
    },
    skip: apiUrl == null ? 'ARDOISE_API_URL non défini' : false,
  );
}
