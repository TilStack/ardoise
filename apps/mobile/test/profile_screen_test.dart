import 'package:ardoise/core/api_client.dart';
import 'package:ardoise/data/local_db.dart';
import 'package:ardoise/data/repository.dart';
import 'package:ardoise/main.dart';
import 'package:ardoise/ui/home.dart';
import 'package:ardoise/ui/theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

class AccountApi extends ApiClient {
  AccountApi({this.failWith}) : super(baseUrl: 'http://fake');
  int deleteCalls = 0;
  final String? failWith;

  @override
  Future<Map<String, dynamic>> deleteAccount() async {
    deleteCalls++;
    if (failWith != null) throw ApiException(failWith!);
    return {'deleted': true};
  }

  // Hors-ligne pour tout le reste : les saisies restent en attente.
  @override
  Future<Map<String, dynamic>> createCustomer({
    required String clientUuid,
    required String name,
    required String phone,
  }) => throw ApiException('Pas de connexion internet');
  @override
  Future<Map<String, dynamic>> syncEntries(
    List<Map<String, dynamic>> entries,
  ) => throw ApiException('Pas de connexion internet');
}

void main() {
  sqfliteFfiInit();
  FlutterSecureStorage.setMockInitialValues({});

  late ArdoiseRepository repo;
  late AccountApi api;
  late Session session;

  Future<void> pumpProfile(
    WidgetTester tester, {
    String? failWith,
    String profile = 'PERSONAL',
    bool withDebt = false,
  }) async {
    tester.view.physicalSize = const Size(360, 1400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    api = AccountApi(failWith: failWith);
    await tester.runAsync(() async {
      repo = ArdoiseRepository(
        api,
        await LocalDb.open(
          name: inMemoryDatabasePath,
          factory: databaseFactoryFfiNoIsolate,
        ),
      );
      await repo.setProfileFromServer(profile, phone: '+237677123456');
      repo.shopName = 'Brice';
      if (withDebt) {
        final paul = await repo.addCustomer('Paul Ngono', '+237677999888');
        await repo.addEntry(
          customerId: paul.id,
          kind: EntryKind.debt,
          amount: 5000,
          label: '',
        );
      }
    });
    session = Session(const FlutterSecureStorage(), api, loggedIn: true);
    await tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider.value(value: repo),
          ChangeNotifierProvider.value(value: session),
        ],
        child: MaterialApp(
          theme: buildTheme(),
          home: const Scaffold(body: ProfileScreen()),
        ),
      ),
    );
  }

  Future<void> settle(WidgetTester tester) async {
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(milliseconds: 200)),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
  }

  testWidgets('affiche le nom, le numéro et le type de profil', (tester) async {
    await pumpProfile(tester);
    expect(find.text('Brice'), findsOneWidget);
    expect(find.textContaining('+237'), findsOneWidget);
    expect(find.text('Profil : Particulier (prêts)'), findsOneWidget);
  });

  testWidgets('un commerçant voit « Commerçant (boutique) »', (tester) async {
    await pumpProfile(tester, profile: 'MERCHANT');
    expect(find.text('Profil : Commerçant (boutique)'), findsOneWidget);
  });

  testWidgets('le thème sombre se choisit et se mémorise sur l’appareil', (
    tester,
  ) async {
    await pumpProfile(tester);
    expect(repo.themeMode, ThemeMode.system);
    await tester.tap(find.text('Sombre'));
    await settle(tester);
    expect(repo.themeMode, ThemeMode.dark);
    late String? saved;
    await tester.runAsync(() async => saved = await repo.db.get('theme_mode'));
    expect(saved, 'dark');
    await tester.tap(find.text('Clair'));
    await settle(tester);
    expect(repo.themeMode, ThemeMode.light);
  });

  testWidgets('la déconnexion demande confirmation', (tester) async {
    await pumpProfile(tester);
    await tester.tap(find.text('Se déconnecter'));
    await tester.pumpAndSettle();
    expect(find.text('Se déconnecter ?'), findsOneWidget);
    await tester.tap(find.text('Annuler'));
    await tester.pumpAndSettle();
    expect(session.loggedIn, isTrue);

    await tester.tap(find.text('Se déconnecter'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Se déconnecter').last);
    await settle(tester);
    expect(session.loggedIn, isFalse);
  });

  testWidgets('suppression refusée tant qu’un compte n’est pas réglé', (
    tester,
  ) async {
    await pumpProfile(tester, withDebt: true);
    await tester.tap(find.text('Supprimer mon compte'));
    await tester.pumpAndSettle();
    expect(find.text('Suppression impossible'), findsOneWidget);
    expect(find.textContaining('non réglé'), findsOneWidget);
    expect(api.deleteCalls, 0);
    expect(session.loggedIn, isTrue);
  });

  testWidgets('suppression : il faut taper SUPPRIMER pour confirmer', (
    tester,
  ) async {
    await pumpProfile(tester);
    await tester.tap(find.text('Supprimer mon compte'));
    await tester.pumpAndSettle();
    expect(find.text('Supprimer mon compte ?'), findsOneWidget);

    // Bouton désactivé tant que le mot n'est pas saisi.
    TextButton confirm() => tester.widget<TextButton>(
      find.widgetWithText(TextButton, 'Supprimer définitivement'),
    );
    expect(confirm().onPressed, isNull);
    await tester.enterText(find.byType(TextField), 'supprimer');
    await tester.pump();
    expect(confirm().onPressed, isNotNull);

    await tester.tap(find.text('Supprimer définitivement'));
    await settle(tester);
    expect(api.deleteCalls, 1);
    expect(session.loggedIn, isFalse);
    expect(repo.profileType, isNull);
    expect(repo.phone, isNull);
  });

  testWidgets(
    'si le serveur refuse, le compte reste connecté et le motif s’affiche',
    (tester) async {
      await pumpProfile(
        tester,
        failWith: 'Suppression impossible : 2 comptes non réglés',
      );
      await tester.tap(find.text('Supprimer mon compte'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField), 'SUPPRIMER');
      await tester.pump();
      await tester.tap(find.text('Supprimer définitivement'));
      await settle(tester);
      expect(api.deleteCalls, 1);
      expect(session.loggedIn, isTrue);
      expect(find.textContaining('2 comptes non réglés'), findsOneWidget);
    },
  );
}
