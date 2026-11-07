import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:provider/provider.dart';

import 'core/api_client.dart';
import 'data/local_db.dart';
import 'data/repository.dart';
import 'ui/home.dart';
import 'ui/login_screen.dart';
import 'ui/theme.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await initializeDateFormatting('fr_FR');
  final storage = const FlutterSecureStorage();
  final api = ApiClient();
  api.token = await storage.read(key: 'token');
  final repo = ArdoiseRepository(api, await LocalDb.open());
  await repo.load();
  runApp(
    ArdoiseApp(
      repo: repo,
      session: Session(storage, api, loggedIn: api.token != null),
    ),
  );
}

/// Session du commerçant : jeton stocké dans le coffre sécurisé du téléphone.
class Session extends ChangeNotifier {
  Session(this._storage, this._api, {required this.loggedIn});
  final FlutterSecureStorage _storage;
  final ApiClient _api;
  bool loggedIn;

  Future<void> signIn(String token) async {
    _api.token = token;
    await _storage.write(key: 'token', value: token);
    loggedIn = true;
    notifyListeners();
  }

  Future<void> signOut(ArdoiseRepository repo) async {
    await _storage.delete(key: 'token');
    _api.token = null;
    await repo.logout();
    loggedIn = false;
    notifyListeners();
  }
}

class ArdoiseApp extends StatelessWidget {
  const ArdoiseApp({super.key, required this.repo, required this.session});
  final ArdoiseRepository repo;
  final Session session;

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider.value(value: repo),
        ChangeNotifierProvider.value(value: session),
      ],
      child: MaterialApp(
        title: "L'Ardoise",
        debugShowCheckedModeBanner: false,
        theme: buildTheme(),
        locale: const Locale('fr'),
        supportedLocales: const [Locale('fr'), Locale('en')],
        localizationsDelegates: GlobalMaterialLocalizations.delegates,
        home: Consumer<Session>(
          builder: (_, s, __) =>
              s.loggedIn ? const HomeShell() : const LoginScreen(),
        ),
      ),
    );
  }
}
