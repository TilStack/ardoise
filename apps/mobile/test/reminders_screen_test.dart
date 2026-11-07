import 'package:ardoise/core/api_client.dart';
import 'package:ardoise/data/local_db.dart';
import 'package:ardoise/data/reminders.dart';
import 'package:ardoise/data/repository.dart';
import 'package:ardoise/ui/reminders_screen.dart';
import 'package:ardoise/ui/theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:provider/provider.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

const _default =
    'Bonjour {prénom}, petit rappel : {montant} FCFA à la {boutique}. Payez ici : {lien}';

Map<String, dynamic> _item(
  String id,
  String name,
  int amount,
  int step,
  String channel, {
  String status = 'SCHEDULED',
  int paid = 0,
}) => {
  'id': id,
  'customerId': 'c-$id',
  'customerName': name,
  'step': step,
  'status': status,
  'channel': channel,
  'scheduledAt': DateTime.now().toUtc().toIso8601String(),
  'amount': amount,
  'sentAt': status == 'SENT' ? DateTime.now().toUtc().toIso8601String() : null,
  'sentChannel': status == 'SENT' ? channel : null,
  'paidAmount': paid,
  'error': null,
};

class FakeRemindersApi extends ApiClient {
  FakeRemindersApi() : super(baseUrl: 'http://fake');
  final actions = <String>[];
  final settingsCalls = <Map<String, Object?>>[];
  String? template;

  @override
  Future<Map<String, dynamic>> reminders() async {
    final eric = _item(
      '5',
      'Éric Atangana',
      8000,
      3,
      'WHATSAPP',
      status: 'SENT',
      paid: 8000,
    );
    return {
      'settings': {
        'enabled': true,
        'sendHour': 9,
        'channel': 'WHATSAPP',
        'template': template ?? _default,
        'customTemplate': template != null,
        'defaultTemplate': _default,
        'optOutSuffix':
            ' Pour ne plus recevoir de rappels, ouvrez le même lien.',
      },
      'today': 4,
      'counts': {'scheduled': 4, 'sent': 1, 'paid': 1},
      'recovered': 8000,
      'scheduled': [
        _item('1', 'Paul Ngono', 12500, 14, 'WHATSAPP'),
        _item('2', 'Junior (taxi)', 1500, 7, 'SMS'),
        _item('3', 'Sandrine Kamga', 4200, 3, 'WHATSAPP'),
        _item('4', 'Éric Atangana', 8000, 3, 'WHATSAPP'),
      ],
      'sent': [eric],
      'paid': [eric],
    };
  }

  @override
  Future<Map<String, dynamic>> reminderAction(
    String id,
    String action, {
    String? channel,
  }) async {
    actions.add('$id:$action${channel == null ? '' : ':$channel'}');
    return {'outcome': 'updated', 'reminder': {}};
  }

  @override
  Future<Map<String, dynamic>> updateReminderSettings(
    Map<String, Object?> changes,
  ) async {
    settingsCalls.add(changes);
    if (changes.containsKey('template')) {
      template = changes['template'] as String?;
    }
    return {};
  }
}

void main() {
  sqfliteFfiInit();

  testWidgets('écran Relances : programmées, onglets, « Modifier », message', (
    tester,
  ) async {
    await initializeDateFormatting('fr_FR');
    tester.view.physicalSize = const Size(360, 640);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final api = FakeRemindersApi();
    late ArdoiseRepository repo;
    await tester.runAsync(() async {
      repo = ArdoiseRepository(
        api,
        await LocalDb.open(
          name: inMemoryDatabasePath,
          factory: databaseFactoryFfiNoIsolate,
        ),
      );
    });
    repo.shopName = 'Boutique Brigitte';

    await tester.pumpWidget(
      ChangeNotifierProvider.value(
        value: repo,
        child: MaterialApp(
          theme: buildTheme(),
          home: const Scaffold(body: RemindersScreen()),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('4 relances aujourd’hui'), findsOneWidget);
    expect(find.text('Envoi à 9 h · max 1 message / 48 h'), findsOneWidget);
    expect(
      find.textContaining('12 500 FCFA · J+14 · WhatsApp'),
      findsOneWidget,
    );
    expect(find.textContaining('1 500 FCFA · J+7 · SMS'), findsOneWidget);
    expect(find.text('Modifier'), findsNWidgets(4));

    // Modifier → passer Junior sur WhatsApp
    await tester.tap(find.text('Modifier').at(1));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Envoyer par WhatsApp'));
    await tester.pumpAndSettle();
    expect(api.actions, ['2:set_channel:WHATSAPP']);

    // Modifier → reporter Paul
    await tester.tap(find.text('Modifier').first);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Reporter à demain'));
    await tester.pumpAndSettle();
    expect(api.actions.last, '1:postpone');

    // Onglet « Payées »
    await tester.tap(find.textContaining('Payées'));
    await tester.pumpAndSettle();
    expect(find.text('Payé 8 000'), findsOneWidget);
    expect(find.text('Modifier'), findsNothing);

    // Message : {lien} obligatoire, aperçu, enregistrement
    await tester.scrollUntilVisible(find.text('Message par défaut'), 200);
    await tester.tap(find.text('Message par défaut'));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const Key('template-field')),
      'Payez svp',
    );
    await tester.pump();
    expect(find.textContaining('doit contenir {lien}'), findsOneWidget);
    await tester.enterText(
      find.byKey(const Key('template-field')),
      'Salut {prénom}, {montant} F chez {boutique} : {lien}',
    );
    await tester.pump();
    expect(
      find.textContaining(
        'Salut Paul, 12 500 F chez Boutique Brigitte : ardoise.cm/p/…',
      ),
      findsOneWidget,
    );
    await tester.tap(find.text('Enregistrer'));
    await tester.pumpAndSettle();
    expect(api.settingsCalls.last, {
      'template': 'Salut {prénom}, {montant} F chez {boutique} : {lien}',
    });
    expect(find.text('Message personnalisé'), findsOneWidget);

    // Réglages : désactiver les relances
    await tester.scrollUntilVisible(
      find.byTooltip('Réglages des relances'),
      -200,
    );
    await tester.tap(find.byTooltip('Réglages des relances'));
    await tester.pumpAndSettle();
    expect(find.text('J+3, J+7, J+14 · entre 8 h et 20 h'), findsOneWidget);
    await tester.tap(find.byType(Switch));
    await tester.pump();
    await tester.tap(find.text('Enregistrer'));
    await tester.pumpAndSettle();
    expect(api.settingsCalls.last, {'enabled': false});
    expect(tester.takeException(), isNull);
  });

  test('validation et aperçu du message identiques à l’API', () {
    expect(validateReminderTemplate(_default), isNull);
    expect(validateReminderTemplate('Bonjour {nom} {lien}'), contains('{nom}'));
    expect(
      renderReminder(
        _default,
        name: 'Paul Ngono',
        amount: '12 500',
        shop: 'Boutique Brigitte',
        url: 'https://x/p/a',
      ),
      'Bonjour Paul, petit rappel : 12 500 FCFA à la Boutique Brigitte. Payez ici : https://x/p/a',
    );
  });
}
