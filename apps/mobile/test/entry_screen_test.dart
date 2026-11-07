import 'package:ardoise/core/api_client.dart';
import 'package:ardoise/data/local_db.dart';
import 'package:ardoise/data/repository.dart';
import 'package:ardoise/ui/entry_screen.dart';
import 'package:ardoise/ui/theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:provider/provider.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

class OfflineApi extends ApiClient {
  OfflineApi() : super(baseUrl: 'http://fake');
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

  testWidgets('pavé numérique : 4 500 FCFA saisis hors-ligne sont enregistrés', (
    tester,
  ) async {
    await initializeDateFormatting('fr_FR');
    // Petit Android d'entrée de gamme : 360 × 640 dp.
    tester.view.physicalSize = const Size(360, 640);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    late ArdoiseRepository repo;
    late Customer paul;
    await tester.runAsync(() async {
      repo = ArdoiseRepository(
        OfflineApi(),
        await LocalDb.open(
          name: inMemoryDatabasePath,
          factory: databaseFactoryFfiNoIsolate,
        ),
      );
      paul = await repo.addCustomer('Paul Ngono', '+237677123456');
      await repo.sync();
    });

    await tester.pumpWidget(
      ChangeNotifierProvider.value(
        value: repo,
        child: MaterialApp(
          theme: buildTheme(),
          home: Builder(
            builder: (ctx) {
              return Scaffold(
                body: Center(
                  child: TextButton(
                    onPressed: () => Navigator.push(
                      ctx,
                      MaterialPageRoute(
                        builder: (_) =>
                            EntryScreen(customer: paul, kind: EntryKind.debt),
                      ),
                    ),
                    child: const Text('ouvrir'),
                  ),
                ),
              );
            },
          ),
        ),
      ),
    );
    await tester.tap(find.text('ouvrir'));
    await tester.pumpAndSettle();

    expect(find.textContaining('Hors-ligne'), findsOneWidget);
    for (final k in ['4', '5', '0', '0']) {
      await tester.tap(find.text(k).last);
    }
    await tester.pump();
    expect(find.textContaining('4 500'), findsWidgets);

    await tester.tap(find.textContaining('Enregistrer'));
    // L'écriture SQLite (FFI) est réellement asynchrone : on lui laisse le temps d'aboutir.
    for (var i = 0; i < 20 && repo.pendingCount == 0; i++) {
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 50)),
      );
      await tester.pump();
    }
    await tester.pumpAndSettle();
    expect(repo.pendingCount, 1);
    expect(repo.byId(paul.id)!.balance, 4500);
    expect(
      find.textContaining('Dette de 4 500 FCFA enregistré'),
      findsOneWidget,
    );
  });
}
