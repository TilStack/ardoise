import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart' show ThemeMode;
import 'package:uuid/uuid.dart';

import '../core/api_client.dart';
import '../core/vocab.dart';
import 'local_db.dart';

enum EntryKind { debt, cash }

class Customer {
  Customer({
    required this.id,
    required this.name,
    required this.phone,
    this.operator,
    required this.serverBalance,
    required this.pendingDelta,
    this.daysLate = 0,
    this.synced = true,
  });

  final String id;
  final String name;
  final String phone;
  final String? operator;
  final int serverBalance;

  /// Somme des saisies locales pas encore confirmées par le serveur (+ dette, − espèces).
  final int pendingDelta;
  final int daysLate;
  final bool synced;

  int get balance => serverBalance + pendingDelta;
  bool get isLate => balance > 0 && daysLate > 0;
}

class DashboardData {
  const DashboardData({
    this.totalOwed = 0,
    this.collectedThisMonth = 0,
    this.inTransit = 0,
    this.lateCount = 0,
  });
  final int totalOwed;
  final int collectedThisMonth;
  final int inTransit;
  final int lateCount;

  factory DashboardData.fromJson(Map<String, dynamic> j) => DashboardData(
    totalOwed: j['totalOwed'] as int? ?? 0,
    collectedThisMonth: j['collectedThisMonth'] as int? ?? 0,
    inTransit: j['inTransit'] as int? ?? 0,
    lateCount: j['lateCount'] as int? ?? 0,
  );
  Map<String, dynamic> toJson() => {
    'totalOwed': totalOwed,
    'collectedThisMonth': collectedThisMonth,
    'inTransit': inTransit,
    'lateCount': lateCount,
  };
}

/// Source unique de l'état de l'app. Écrit d'abord en local, synchronise ensuite.
///
/// Garanties :
///  - une saisie hors-ligne apparaît immédiatement dans le solde (delta local) ;
///  - elle n'est envoyée qu'avec son UUID : la rejouer après une coupure ne crée pas de doublon côté serveur ;
///  - elle ne quitte la file qu'une fois confirmée par le serveur.
class ArdoiseRepository extends ChangeNotifier {
  ArdoiseRepository(this.api, this.db, {Uuid? uuid})
    : _uuid = uuid ?? const Uuid();

  final ApiClient api;
  final LocalDb db;
  final Uuid _uuid;

  List<Customer> customers = [];
  DashboardData dashboard = const DashboardData();
  String? shopName;

  /// Numéro du compte (format +237…), affiché dans Profil.
  String? phone;

  /// 'MERCHANT' ou 'PERSONAL' ; null tant que le choix n'a pas été fait.
  String? profileType;
  bool get isPersonal => profileType == 'PERSONAL';

  /// Apparence : clair, sombre ou celle du téléphone. Mémorisée sur l'appareil.
  ThemeMode themeMode = ThemeMode.system;
  Future<void> setThemeMode(ThemeMode mode) async {
    themeMode = mode;
    notifyListeners();
    await db.set('theme_mode', mode.name);
  }

  /// Supprime définitivement le compte (serveur), puis efface toutes les données du téléphone.
  /// Le serveur refuse tant que des comptes ne sont pas réglés.
  Future<void> deleteAccount() async {
    if (pendingCount > 0) {
      await sync(); // les dernières saisies doivent être connues du serveur avant de juger les soldes
    }
    await api.deleteAccount();
    await logout();
  }

  /// Choix fait sur l'écran d'accueil, avant la connexion :
  /// 'MERCHANT', 'PERSONAL' ou 'EXISTING' (« j'ai déjà un compte »). null = écran d'accueil.
  String? welcomeChoice;
  void setWelcomeChoice(String? choice) {
    welcomeChoice = choice;
    notifyListeners();
  }

  /// Message à afficher une fois après la connexion quand le profil choisi à l'accueil
  /// diffère de celui déjà enregistré pour ce numéro (le profil du numéro l'emporte).
  String? profileNotice;
  void noteProfileMismatch(String? serverType) {
    final chosen = welcomeChoice;
    if (serverType == null ||
        (chosen != 'MERCHANT' && chosen != 'PERSONAL') ||
        chosen == serverType) {
      return;
    }
    final name = serverType == 'PERSONAL'
        ? 'Particulier (prêts)'
        : 'Commerçant (boutique)';
    profileNotice =
        'Ce numéro est déjà enregistré en profil $name : c’est celui qui est utilisé.';
  }

  String? takeProfileNotice() {
    final n = profileNotice;
    profileNotice = null;
    return n;
  }

  Vocab get vocab => Vocab(personal: isPersonal);
  int pendingCount = 0;
  bool online = true;
  bool syncing = false;
  String? lastError;

  Future<void> load() async {
    shopName = await db.get('shop_name');
    profileType = await db.get('profile_type');
    phone = await db.get('account_phone');
    final savedTheme = await db.get('theme_mode');
    themeMode = ThemeMode.values.firstWhere(
      (m) => m.name == savedTheme,
      orElse: () => ThemeMode.system,
    );
    final d = await db.get('dashboard');
    if (d != null) {
      dashboard = DashboardData.fromJson(jsonDecode(d) as Map<String, dynamic>);
    }
    await _rebuild();
  }

  Future<void> _rebuild() async {
    final rows = await db.customers();
    final pending = await db.pending();
    pendingCount = pending.length;
    final delta = <String, int>{};
    for (final e in pending) {
      if (e['error'] != null) {
        continue; // rejetée par le serveur : n'affecte plus le solde affiché
      }
      final amount = e['amount'] as int;
      delta.update(
        e['customer_id'] as String,
        (v) => v + (e['type'] == 'DEBT' ? amount : -amount),
        ifAbsent: () => e['type'] == 'DEBT' ? amount : -amount,
      );
    }
    customers =
        rows
            .map(
              (r) => Customer(
                id: r['id'] as String,
                name: r['name'] as String,
                phone: r['phone'] as String,
                operator: r['operator'] as String?,
                serverBalance: r['server_balance'] as int,
                pendingDelta: delta[r['id']] ?? 0,
                daysLate: r['days_late'] as int,
                synced: (r['synced'] as int) == 1,
              ),
            )
            .toList()
          ..sort(
            (a, b) => b.daysLate.compareTo(a.daysLate) != 0
                ? b.daysLate.compareTo(a.daysLate)
                : b.balance.compareTo(a.balance),
          );
    notifyListeners();
  }

  /// Total dû affiché : serveur + saisies locales en attente.
  int get totalOwed =>
      customers.fold(0, (t, c) => t + (c.balance > 0 ? c.balance : 0));
  List<Customer> get late => customers.where((c) => c.isLate).toList();
  Customer? byId(String id) => customers.where((c) => c.id == id).firstOrNull;

  // ---------------- Saisies ----------------

  Future<Customer> addCustomer(String name, String phoneE164) async {
    final existing = customers.where((c) => c.phone == phoneE164).firstOrNull;
    if (existing != null) return existing;
    final id = _uuid.v4();
    await db.upsertCustomer({
      'id': id,
      'name': name.trim(),
      'phone': phoneE164,
      'server_balance': 0,
      'days_late': 0,
      'synced': 0,
    });
    await _rebuild();
    _fireAndForget(sync());
    return byId(id)!;
  }

  /// Enregistre une dette ou un remboursement en espèces. Fonctionne sans réseau.
  Future<void> addEntry({
    required String customerId,
    required EntryKind kind,
    required int amount,
    String? label,
  }) async {
    if (amount <= 0 || amount > 10000000) {
      throw ArgumentError('Montant invalide');
    }
    await db.enqueue({
      'client_uuid': _uuid.v4(),
      'customer_id': customerId,
      'type': kind == EntryKind.debt ? 'DEBT' : 'CASH_REPAYMENT',
      'amount': amount,
      'label': (label == null || label.trim().isEmpty) ? null : label.trim(),
      'occurred_at': DateTime.now().toUtc().toIso8601String(),
    });
    await _rebuild();
    _fireAndForget(sync());
  }

  // ---------------- Synchronisation ----------------

  Future<void>? _inflight;
  bool _again = false;

  /// Envoie la file puis rafraîchit le miroir. Un seul passage à la fois ; une demande faite
  /// pendant un passage en déclenche un autre (la saisie qui vient d'arriver n'est jamais oubliée),
  /// et le Future rendu ne se termine qu'après ce dernier passage.
  Future<void> sync() {
    if (_inflight != null) {
      _again = true;
      return _inflight!;
    }
    final run = () async {
      do {
        _again = false;
        await _doSync();
      } while (_again);
    }();
    return _inflight = run.whenComplete(() => _inflight = null);
  }

  Future<void> _doSync() async {
    syncing = true;
    notifyListeners();
    try {
      // 1. Clients créés hors-ligne d'abord (les écritures en dépendent).
      for (final c in await db.unsyncedCustomers()) {
        final r = await api.createCustomer(
          clientUuid: c['id'] as String,
          name: c['name'] as String,
          phone: c['phone'] as String,
        );
        if (r['id'] != c['id']) {
          // Le numéro existait déjà côté serveur : on rattache les saisies locales au client existant.
          await db.db.update(
            'outbox',
            {'customer_id': r['id']},
            where: 'customer_id = ?',
            whereArgs: [c['id']],
          );
          await db.db.delete(
            'customers',
            where: 'id = ?',
            whereArgs: [c['id']],
          );
        } else {
          await db.markCustomerSynced(c['id'] as String);
        }
      }
      // 2. File d'attente, par lots, dans l'ordre de saisie.
      final pending = (await db.pending())
          .where((e) => e['error'] == null)
          .toList();
      for (var i = 0; i < pending.length; i += 200) {
        final chunk = pending.skip(i).take(200).toList();
        final res = await api.syncEntries(
          chunk
              .map(
                (e) => {
                  'clientUuid': e['client_uuid'],
                  'customerId': e['customer_id'],
                  'type': e['type'],
                  'amount': e['amount'],
                  if (e['label'] != null) 'label': e['label'],
                  'occurredAt': e['occurred_at'],
                },
              )
              .toList(),
        );
        final done = <String>[];
        for (final r in (res['results'] as List).cast<Map<String, dynamic>>()) {
          if (r['status'] == 'CREATED' || r['status'] == 'DUPLICATE') {
            done.add(r['clientUuid'] as String);
          } else {
            await db.markRejected(
              r['clientUuid'] as String,
              r['error']?.toString() ?? 'Rejetée',
            );
          }
        }
        await db.dequeue(done);
      }
      // 3. Miroir serveur (soldes faisant foi) et tableau de bord.
      await _pull();
      online = true;
      lastError = null;
    } on ApiException catch (e) {
      online = !e.isNetwork;
      lastError = e.isNetwork ? null : e.message;
    } finally {
      syncing = false;
      await _rebuild();
    }
  }

  Future<void> _pull() async {
    final list = await api.customers();
    final rows = (list['customers'] as List).cast<Map<String, dynamic>>().map(
      (c) => <String, Object?>{
        'id': c['id'],
        'name': c['name'],
        'phone': c['phone'],
        'operator': c['operator'],
        'server_balance': c['balance'],
        'last_activity_at': c['lastActivityAt'],
        'days_late': c['daysLate'] ?? 0,
      },
    );
    await db.replaceServerCustomers(rows.toList());
    final d = await api.dashboard();
    dashboard = DashboardData.fromJson(d);
    await db.set('dashboard', jsonEncode(dashboard.toJson()));
    try {
      await refreshProfile(); // numéro et nom à jour pour l'écran Profil
    } on ApiException {
      // non bloquant : la synchro des données a réussi
    }
  }

  // ---------------- En ligne uniquement ----------------

  Future<Map<String, dynamic>> customerDetail(String id) => api.customer(id);

  /// Archive un client soldé (en ligne). L'historique est conservé côté serveur ;
  /// le client disparaît des listes à la prochaine synchro.
  Future<void> archiveCustomer(String id) async {
    if (pendingCount > 0) {
      await sync(); // le serveur doit connaître toutes les saisies avant de juger le solde
    }
    await api.archiveCustomer(id);
  }

  Future<void> cancelEntry(String entryId) async {
    await api.cancelEntry(entryId, _uuid.v4(), 'Annulation depuis l’app');
    await sync();
  }

  Future<Map<String, dynamic>> paymentLink(String customerId) async {
    if (pendingCount > 0) {
      await sync(); // le message doit refléter le vrai solde
    }
    return api.paymentLink(customerId);
  }

  Future<void> setShopName(String name) async {
    shopName = name;
    await db.set('shop_name', name);
    notifyListeners();
    try {
      await api.updateMe(shopName: name);
    } on ApiException {
      // réessayé au prochain lancement
    }
  }

  /// Profil reçu du serveur à la connexion ou au démarrage (null = pas encore choisi).
  Future<void> setProfileFromServer(String? type, {String? phone}) async {
    profileType = type;
    await db.set('profile_type', type);
    if (phone != null) {
      this.phone = phone;
      await db.set('account_phone', phone);
    }
    notifyListeners();
  }

  /// Premier choix du profil : doit réussir en ligne, le serveur choisit les modèles de messages.
  Future<void> chooseProfile(String type, String name) async {
    await api.updateMe(profileType: type, shopName: name);
    shopName = name;
    await db.set('shop_name', name);
    await setProfileFromServer(type);
  }

  /// Relit le profil sur le serveur (comptes créés avant l'arrivée des profils).
  Future<void> refreshProfile() async {
    final me = await api.me();
    final name = me['shopName'] as String?;
    if (name != null) {
      shopName = name;
      await db.set('shop_name', name);
    }
    await setProfileFromServer(
      me['profileType'] as String?,
      phone: me['phone'] as String?,
    );
  }

  Future<void> logout() async {
    await db.clearAll();
    customers = [];
    dashboard = const DashboardData();
    shopName = null;
    profileType = null;
    phone = null;
    welcomeChoice = null;
    pendingCount = 0;
    notifyListeners();
  }
}

void _fireAndForget(Future<void> f) => f.catchError((Object _) {});
