import 'package:ardoise/core/api_client.dart';
import 'package:ardoise/core/vocab.dart';
import 'package:ardoise/data/local_db.dart';
import 'package:ardoise/data/repository.dart';
import 'package:ardoise/main.dart';
import 'package:ardoise/ui/profile_choice_screen.dart';
import 'package:ardoise/ui/theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

class RecordingApi extends ApiClient {
  RecordingApi() : super(baseUrl: 'http://fake');
  final calls = <Map<String, String?>>[];
  @override
  Future<Map<String, dynamic>> updateMe({
    String? shopName,
    String? profileType,
  }) async {
    calls.add({'shopName': shopName, 'profileType': profileType});
    return {'shopName': shopName, 'profileType': profileType};
  }
}

void main() {
  sqfliteFfiInit();

  group('Vocab', () {
    test('commerçant : clients et dettes', () {
      const v = Vocab(personal: false);
      expect(v.people, 'Clients');
      expect(v.newDebt, 'Nouvelle dette');
      expect(v.count(1), '1 client');
      expect(v.count(3), '3 clients');
    });

    test('particulier : personnes et prêts, sans mot « boutique »', () {
      const v = Vocab(personal: true);
      expect(v.people, 'Personnes');
      expect(v.newDebt, 'Nouveau prêt');
      expect(v.count(1), '1 personne');
      expect(v.count(3), '3 personnes');
      final all = [
        v.people,
        v.person,
        v.thePerson,
        v.newPerson,
        v.addPerson,
        v.forWhichPerson,
        v.debt,
        v.newDebt,
        v.cashReceived,
        v.homeTitle,
        v.nameTitle,
        v.nameHelp,
        v.noLate,
        v.emptyList,
        v.owesLabel,
        v.remindersOff,
        v.noWhatsapp,
      ].join(' ').toLowerCase();
      expect(all, isNot(contains('boutique')));
      expect(all, isNot(contains('client')));
    });
  });

  group('Choix du profil', () {
    Future<(ArdoiseRepository, RecordingApi)> setup(WidgetTester tester) async {
      tester.view.physicalSize = const Size(360, 780);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      late ArdoiseRepository repo;
      final api = RecordingApi();
      await tester.runAsync(() async {
        repo = ArdoiseRepository(
          api,
          await LocalDb.open(
            name: inMemoryDatabasePath,
            factory: databaseFactoryFfiNoIsolate,
          ),
        );
      });
      await tester.pumpWidget(
        MultiProvider(
          providers: [
            ChangeNotifierProvider.value(value: repo),
            ChangeNotifierProvider.value(
              value: Session(const FlutterSecureStorage(), api, loggedIn: true),
            ),
          ],
          child: MaterialApp(
            theme: buildTheme(),
            home: const ProfileChoiceScreen(),
          ),
        ),
      );
      return (repo, api);
    }

    testWidgets('refuse de continuer sans avoir choisi un profil', (
      tester,
    ) async {
      final (repo, api) = await setup(tester);
      await tester.tap(find.text('Continuer'));
      await tester.pump();
      expect(find.text('Choisissez votre profil'), findsOneWidget);
      expect(api.calls, isEmpty);
      expect(repo.profileType, isNull);
    });

    testWidgets('particulier : envoie le profil et le prénom au serveur', (
      tester,
    ) async {
      final (repo, api) = await setup(tester);
      await tester.tap(find.text('Pour mes prêts'));
      await tester.pump();
      expect(find.text('Votre prénom'), findsOneWidget);
      await tester.enterText(find.byType(TextField), 'Brice');
      await tester.tap(find.text('Continuer'));
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 200)),
      );
      await tester.pump();
      expect(api.calls, [
        {'shopName': 'Brice', 'profileType': 'PERSONAL'},
      ]);
      expect(repo.profileType, 'PERSONAL');
      expect(repo.isPersonal, isTrue);
      expect(repo.shopName, 'Brice');
    });

    testWidgets('commerçant : le nom de la boutique est demandé', (
      tester,
    ) async {
      final (repo, api) = await setup(tester);
      await tester.tap(find.text('Pour ma boutique'));
      await tester.pump();
      expect(find.text('Nom de votre boutique'), findsOneWidget);
      await tester.enterText(find.byType(TextField), 'B');
      await tester.tap(find.text('Continuer'));
      await tester.pump();
      expect(find.text('Indiquez le nom de votre boutique'), findsOneWidget);
      expect(api.calls, isEmpty);
      expect(repo.profileType, isNull);
    });
  });
}
