import 'package:ardoise/core/api_client.dart';
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

void main() {
  sqfliteFfiInit();

  Future<ArdoiseRepository> newRepo(WidgetTester tester) async {
    tester.view.physicalSize = const Size(360, 780);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    late ArdoiseRepository repo;
    await tester.runAsync(() async {
      repo = ArdoiseRepository(
        ApiClient(baseUrl: 'http://fake'),
        await LocalDb.open(
          name: inMemoryDatabasePath,
          factory: databaseFactoryFfiNoIsolate,
        ),
      );
    });
    return repo;
  }

  Widget app(ArdoiseRepository repo) => ArdoiseApp(
    repo: repo,
    session: Session(
      const FlutterSecureStorage(),
      ApiClient(baseUrl: 'http://fake'),
      loggedIn: false,
    ),
  );

  testWidgets('l’entrée de l’app est le choix du profil, avant le numéro', (
    tester,
  ) async {
    final repo = await newRepo(tester);
    await tester.pumpWidget(app(repo));
    expect(find.text('Pour ma boutique'), findsOneWidget);
    expect(find.text('Pour mes prêts'), findsOneWidget);
    expect(find.text('J’ai déjà un compte'), findsOneWidget);
    expect(find.text('Numéro de téléphone'), findsNothing);
  });

  testWidgets('choisir « Pour mes prêts » mène à la saisie du numéro', (
    tester,
  ) async {
    final repo = await newRepo(tester);
    await tester.pumpWidget(app(repo));
    await tester.tap(find.text('Pour mes prêts'));
    await tester.pumpAndSettle();
    expect(repo.welcomeChoice, 'PERSONAL');
    expect(find.text('Numéro de téléphone'), findsOneWidget);
    expect(find.text('Pour mes prêts · changer'), findsOneWidget);
  });

  testWidgets('« J’ai déjà un compte » mène à la saisie du numéro', (
    tester,
  ) async {
    final repo = await newRepo(tester);
    await tester.pumpWidget(app(repo));
    await tester.tap(find.text('J’ai déjà un compte'));
    await tester.pumpAndSettle();
    expect(repo.welcomeChoice, 'EXISTING');
    expect(find.text('Numéro de téléphone'), findsOneWidget);
  });

  testWidgets('on peut revenir au choix du profil depuis la saisie du numéro', (
    tester,
  ) async {
    final repo = await newRepo(tester);
    await tester.pumpWidget(app(repo));
    await tester.tap(find.text('Pour ma boutique'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Pour ma boutique · changer'));
    await tester.pumpAndSettle();
    expect(repo.welcomeChoice, isNull);
    expect(find.text('Pour mes prêts'), findsOneWidget);
  });

  testWidgets('après connexion, un profil déjà choisi ne demande que le nom', (
    tester,
  ) async {
    final repo = await newRepo(tester);
    await tester.pumpWidget(
      ChangeNotifierProvider.value(
        value: repo,
        child: MaterialApp(
          theme: buildTheme(),
          home: const ProfileChoiceScreen(initialType: 'PERSONAL'),
        ),
      ),
    );
    expect(find.text('Dernière étape'), findsOneWidget);
    expect(find.text('Votre prénom'), findsOneWidget);
  });
}
