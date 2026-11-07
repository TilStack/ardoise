// Rendu des écrans principaux en PNG avec les vraies polices (Roboto, comme sur Android).
// Usage : flutter test tool/screenshots_test.dart --update-goldens  →  tool/screenshots/*.png
import 'dart:io';

import 'package:ardoise/core/api_client.dart';
import 'package:ardoise/data/local_db.dart';
import 'package:ardoise/data/repository.dart';
import 'package:ardoise/ui/entry_screen.dart';
import 'package:ardoise/ui/home.dart';
import 'package:ardoise/ui/reminders_screen.dart';
import 'package:ardoise/ui/theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:provider/provider.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

class DemoApi extends ApiClient {
  DemoApi() : super(baseUrl: 'http://demo');
  final rows = [
    ['Paul Ngono', '+237677123456', 12500, 14],
    ['Maman Clarisse', '+237655443322', 12000, 0],
    ['Junior (taxi)', '+237699001122', 1500, 7],
    ['Éric Atangana', '+237678001122', 8000, 0],
    ['Aïcha Bello', '+237690112233', 0, 0],
  ];
  @override
  Future<Map<String, dynamic>> customers() async => {
    'customers': [
      for (var i = 0; i < rows.length; i++)
        {
          'id': 'c$i',
          'name': rows[i][0],
          'phone': rows[i][1],
          'operator': 'MTN',
          'balance': rows[i][2],
          'daysLate': rows[i][3],
          'lastActivityAt': null,
        },
    ],
  };
  @override
  Future<Map<String, dynamic>> dashboard() async => {
    'totalOwed': 34000,
    'collectedThisMonth': 64000,
    'inTransit': 7500,
    'lateCount': 2,
  };
  @override
  Future<Map<String, dynamic>> reminders() async {
    final nine = DateTime.now().copyWith(hour: 9, minute: 0, second: 0);
    Map<String, dynamic> r(
      String id,
      String name,
      int amount,
      int step,
      String ch, {
      DateTime? sent,
      int paid = 0,
    }) => {
      'id': id,
      'customerId': 'c$id',
      'customerName': name,
      'step': step,
      'status': sent == null ? 'SCHEDULED' : 'SENT',
      'channel': ch,
      'scheduledAt': nine.toUtc().toIso8601String(),
      'amount': amount,
      'sentAt': sent?.toUtc().toIso8601String(),
      'sentChannel': sent == null ? null : ch,
      'paidAmount': paid,
      'error': null,
    };
    final sent = [
      r(
        's1',
        'Maman Clarisse',
        12000,
        7,
        'WHATSAPP',
        sent: nine.subtract(const Duration(days: 2)),
        paid: 12000,
      ),
      r(
        's2',
        'Aïcha Bello',
        3500,
        3,
        'WHATSAPP',
        sent: nine.subtract(const Duration(days: 3)),
        paid: 3500,
      ),
    ];
    return {
      'settings': {
        'enabled': true,
        'sendHour': 9,
        'channel': 'WHATSAPP',
        'template':
            'Bonjour {prénom}, petit rappel : {montant} FCFA à la {boutique}. Payez ici : {lien}',
        'customTemplate': false,
        'defaultTemplate':
            'Bonjour {prénom}, petit rappel : {montant} FCFA à la {boutique}. Payez ici : {lien}',
        'optOutSuffix':
            ' Pour ne plus recevoir de rappels, ouvrez le même lien.',
      },
      'today': 4,
      'recovered': 15500,
      'scheduled': [
        r('1', 'Paul Ngono', 12500, 14, 'WHATSAPP'),
        r('2', 'Junior (taxi)', 1500, 7, 'SMS'),
        r('3', 'Sandrine Kamga', 4200, 3, 'WHATSAPP'),
        r('4', 'Éric Atangana', 8000, 3, 'WHATSAPP'),
      ],
      'sent': sent,
      'paid': sent,
    };
  }

  @override
  Future<Map<String, dynamic>> syncEntries(
    List<Map<String, dynamic>> entries,
  ) async => {'results': []};
}

Future<void> loadFonts() async {
  Future<void> family(String name, List<String> files) async {
    final loader = FontLoader(name);
    for (final f in files) {
      loader.addFont(
        Future.value(ByteData.sublistView(File(f).readAsBytesSync())),
      );
    }
    await loader.load();
  }

  const r = '/opt/flutter/bin/cache/artifacts/material_fonts';
  await family('Roboto', [
    '$r/Roboto-Regular.ttf',
    '$r/Roboto-Medium.ttf',
    '$r/Roboto-Bold.ttf',
    '$r/Roboto-Black.ttf',
  ]);
  await family('MaterialIcons', ['$r/MaterialIcons-Regular.otf']);
}

void main() {
  sqfliteFfiInit();

  Future<ArdoiseRepository> demoRepo(WidgetTester t) async {
    late ArdoiseRepository repo;
    await t.runAsync(() async {
      repo = ArdoiseRepository(
        DemoApi(),
        await LocalDb.open(
          name: inMemoryDatabasePath,
          factory: databaseFactoryFfiNoIsolate,
        ),
      );
      await repo.setShopName('Boutique Bonamoussadi');
      await repo.sync();
    });
    return repo;
  }

  Future<void> shoot(WidgetTester t, Widget screen, String name) async {
    await initializeDateFormatting('fr_FR');
    await loadFonts();
    t.view.physicalSize = const Size(720, 1560);
    t.view.devicePixelRatio = 2;
    addTearDown(t.view.reset);
    final repo = await demoRepo(t);
    await t.pumpWidget(
      ChangeNotifierProvider.value(
        value: repo,
        child: MaterialApp(
          debugShowCheckedModeBanner: false,
          theme: buildTheme(fontFamily: 'Roboto'),
          home: screen,
        ),
      ),
    );
    await t.pumpAndSettle();
    await expectLater(
      find.byType(MaterialApp),
      matchesGoldenFile('screenshots/$name.png'),
    );
  }

  testWidgets(
    'tableau de bord',
    (t) => shoot(
      t,
      const Scaffold(body: SafeArea(child: DashboardScreen())),
      '02-tableau-de-bord',
    ),
  );
  testWidgets(
    'clients',
    (t) => shoot(
      t,
      const Scaffold(body: SafeArea(child: CustomersScreen())),
      '03-clients',
    ),
  );
  testWidgets('saisie', (t) async {
    final c = Customer(
      id: 'c0',
      name: 'Paul Ngono',
      phone: '+237677123456',
      serverBalance: 12500,
      pendingDelta: 0,
    );
    await shoot(
      t,
      EntryScreen(customer: c, kind: EntryKind.debt),
      '05-nouvelle-dette',
    );
  });
  testWidgets(
    'relances',
    (t) => shoot(
      t,
      const Scaffold(body: SafeArea(child: RemindersScreen())),
      '10-relances',
    ),
  );
}
