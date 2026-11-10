import 'package:ardoise/core/api_client.dart';
import 'package:ardoise/data/local_db.dart';
import 'package:ardoise/data/repository.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

void main() {
  sqfliteFfiInit();

  Future<ArdoiseRepository> makeRepo() async => ArdoiseRepository(
    ApiClient(baseUrl: 'http://fake'),
    await LocalDb.open(
      name: inMemoryDatabasePath,
      factory: databaseFactoryFfiNoIsolate,
    ),
  );

  test('le profil du numéro l’emporte et l’utilisateur est prévenu', () async {
    final repo = await makeRepo();
    repo.setWelcomeChoice('MERCHANT');
    repo.noteProfileMismatch('PERSONAL');
    final notice = repo.takeProfileNotice();
    expect(notice, contains('Particulier'));
    expect(repo.takeProfileNotice(), isNull, reason: 'affiché une seule fois');
  });

  test('pas de message quand le choix correspond au numéro', () async {
    final repo = await makeRepo();
    repo.setWelcomeChoice('PERSONAL');
    repo.noteProfileMismatch('PERSONAL');
    expect(repo.takeProfileNotice(), isNull);
  });

  test('pas de message pour « j’ai déjà un compte » ni pour un nouveau numéro', () async {
    final repo = await makeRepo();
    repo.setWelcomeChoice('EXISTING');
    repo.noteProfileMismatch('MERCHANT');
    expect(repo.takeProfileNotice(), isNull);
    repo.setWelcomeChoice('MERCHANT');
    repo.noteProfileMismatch(null);
    expect(repo.takeProfileNotice(), isNull);
  });
}
