import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;

/// Erreur renvoyée par l'API (message en français, prêt à afficher).
class ApiException implements Exception {
  ApiException(this.message, {this.status});
  final String message;
  final int? status;

  /// Pas de réponse du serveur : on reste en mode hors-ligne, la saisie sera synchronisée plus tard.
  bool get isNetwork => status == null;

  @override
  String toString() => message;
}

/// Client HTTP de l'API L'Ardoise. L'URL vient de `--dart-define=API_URL=...`.
class ApiClient {
  ApiClient({
    String? baseUrl,
    http.Client? client,
    this.timeout = const Duration(seconds: 12),
  }) : baseUrl =
           (baseUrl ??
                   const String.fromEnvironment(
                     'API_URL',
                     defaultValue: 'http://10.0.2.2:3000',
                   ))
               .replaceAll(RegExp(r'/$'), ''),
       _http = client ?? http.Client();

  final String baseUrl;
  final http.Client _http;
  final Duration timeout;
  String? token;

  Future<dynamic> _send(String method, String path, [Object? body]) async {
    final req = http.Request(method, Uri.parse('$baseUrl$path'));
    req.headers['Content-Type'] = 'application/json';
    req.headers['Accept'] = 'application/json';
    if (token != null) req.headers['Authorization'] = 'Bearer $token';
    if (body != null) req.body = jsonEncode(body);
    http.Response res;
    try {
      res = await http.Response.fromStream(
        await _http.send(req).timeout(timeout),
      );
    } on SocketException {
      throw ApiException('Pas de connexion internet');
    } on TimeoutException {
      throw ApiException('Le serveur ne répond pas');
    } on http.ClientException {
      throw ApiException('Pas de connexion internet');
    }
    final decoded = res.body.isEmpty
        ? null
        : jsonDecode(utf8.decode(res.bodyBytes));
    if (res.statusCode >= 400) {
      final m = decoded is Map ? decoded['message'] : null;
      throw ApiException(
        m is List
            ? m.first.toString()
            : (m?.toString() ?? 'Erreur ${res.statusCode}'),
        status: res.statusCode,
      );
    }
    return decoded;
  }

  // ---- Auth ----
  Future<Map<String, dynamic>> requestOtp(String phone) async =>
      await _send('POST', '/auth/otp/request', {'phone': phone});
  Future<Map<String, dynamic>> verifyOtp(String phone, String code) async =>
      await _send('POST', '/auth/otp/verify', {'phone': phone, 'code': code});

  // ---- Boutique ----
  Future<Map<String, dynamic>> me() async => await _send('GET', '/me');
  Future<Map<String, dynamic>> updateMe(String shopName) async =>
      await _send('PATCH', '/me', {'shopName': shopName});
  Future<Map<String, dynamic>> dashboard() async =>
      await _send('GET', '/dashboard');

  // ---- Clients ----
  Future<Map<String, dynamic>> customers() async =>
      await _send('GET', '/customers');
  Future<Map<String, dynamic>> customer(String id) async =>
      await _send('GET', '/customers/$id');
  Future<Map<String, dynamic>> createCustomer({
    required String clientUuid,
    required String name,
    required String phone,
  }) async => await _send('POST', '/customers', {
    'clientUuid': clientUuid,
    'name': name,
    'phone': phone,
  });

  // ---- Écritures ----
  Future<Map<String, dynamic>> syncEntries(
    List<Map<String, dynamic>> entries,
  ) async => await _send('POST', '/sync/entries', {'entries': entries});
  Future<Map<String, dynamic>> cancelEntry(
    String entryId,
    String clientUuid,
    String reason,
  ) async => await _send('POST', '/entries/$entryId/cancel', {
    'clientUuid': clientUuid,
    'reason': reason,
  });

  // ---- Paiement ----
  Future<Map<String, dynamic>> paymentLink(String customerId) async =>
      await _send('POST', '/customers/$customerId/payment-link', {});

  // ---- Relances ----
  Future<Map<String, dynamic>> reminders() async =>
      await _send('GET', '/reminders');
  Future<Map<String, dynamic>> updateReminderSettings(
    Map<String, Object?> changes,
  ) async => await _send('PATCH', '/reminders/settings', changes);
  Future<Map<String, dynamic>> reminderAction(
    String id,
    String action, {
    String? channel,
  }) async => await _send('PATCH', '/reminders/$id', {
    'action': action,
    if (channel != null) 'channel': channel,
  });
}
