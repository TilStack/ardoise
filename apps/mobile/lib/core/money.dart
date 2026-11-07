import 'package:intl/intl.dart';

final _fmt = NumberFormat.decimalPattern('fr_FR');

/// 12500 → "12 500" (espaces fines normalisées en espaces simples pour l'affichage).
String formatAmount(int amount) =>
    _fmt.format(amount).replaceAll(' ', ' ').replaceAll(' ', ' ');

/// 12500 → "12 500 FCFA"
String fcfa(int amount) => '${formatAmount(amount)} FCFA';

/// Initiales d'un nom : "Paul Ngono" → "PN", "Junior (taxi)" → "JT".
String initials(String name) {
  final words = name
      .replaceAll(RegExp(r'[^\p{L}\s]', unicode: true), ' ')
      .split(RegExp(r'\s+'))
      .where((w) => w.isNotEmpty)
      .toList();
  if (words.isEmpty) return '?';
  return words.take(2).map((w) => w[0].toUpperCase()).join();
}

/// Numéro camerounais au format E.164, ou null si invalide. Même règle que l'API.
String? normalizeCmPhone(String input) {
  var d = input.replaceAll(RegExp(r'[^\d+]'), '');
  if (d.startsWith('+')) d = d.substring(1);
  if (d.startsWith('00')) d = d.substring(2);
  if (d.startsWith('237') && d.length == 12) d = d.substring(3);
  if (!RegExp(r'^6\d{8}$').hasMatch(d)) return null;
  return '+237$d';
}

/// +237677123456 → "6 77 12 34 56"
String displayPhone(String e164) {
  final l = e164.startsWith('+237') ? e164.substring(4) : e164;
  if (l.length != 9) return e164;
  return '${l[0]} ${l.substring(1, 3)} ${l.substring(3, 5)} ${l.substring(5, 7)} ${l.substring(7)}';
}
