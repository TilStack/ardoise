import 'package:flutter/material.dart';

/// Couleurs de la maquette Figma « L'Ardoise ».
abstract final class AppColors {
  static const slate = Color(0xFF1F2D35);
  static const slateSoft = Color(0xFF26343C);
  static const orange = Color(0xFFEA580C);
  static const orangeSoft = Color(0xFFFFEDD5);
  static const chalk = Color(0xFFFB923C);
  static const paper = Color(0xFFFAF8F4);
  static const card = Colors.white;
  static const line = Color(0xFFECE7DD);
  static const field = Color(0xFFF0ECE3);
  static const ink = Color(0xFF18222A);
  static const muted = Color(0xFF6B747A);
  static const green = Color(0xFF15803D);
  static const greenSoft = Color(0xFFDCFCE7);
  static const amber = Color(0xFFB45309);
  static const amberSoft = Color(0xFFFEF3C7);
  static const red = Color(0xFFB91C1C);
  static const redSoft = Color(0xFFFEE2E2);
  static const greySoft = Color(0xFFE8EDEF);
}

ThemeData buildTheme({String? fontFamily}) {
  final base = ThemeData(
    useMaterial3: true,
    fontFamily: fontFamily,
    colorSchemeSeed: AppColors.slate,
    scaffoldBackgroundColor: AppColors.paper,
  );
  return base.copyWith(
    colorScheme: base.colorScheme.copyWith(
      primary: AppColors.slate,
      secondary: AppColors.orange,
      surface: AppColors.paper,
    ),
    appBarTheme: const AppBarTheme(
      backgroundColor: AppColors.paper,
      foregroundColor: AppColors.ink,
      elevation: 0,
      scrolledUnderElevation: 0,
    ),
    textTheme: base.textTheme.apply(
      bodyColor: AppColors.ink,
      displayColor: AppColors.ink,
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: Colors.white,
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 16),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: const BorderSide(color: Color(0xFFE3DED3), width: 1.5),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: const BorderSide(color: Color(0xFFE3DED3), width: 1.5),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: const BorderSide(color: AppColors.slate, width: 1.5),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: AppColors.orange,
        foregroundColor: Colors.white,
        minimumSize: const Size.fromHeight(52),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        textStyle: TextStyle(
          fontFamily: fontFamily,
          fontSize: 15,
          fontWeight: FontWeight.w700,
        ),
      ),
    ),
  );
}

/// Pastille de statut (retard, relancé, à jour…).
class Pill extends StatelessWidget {
  const Pill(this.text, {super.key, required this.fg, required this.bg});
  final String text;
  final Color fg;
  final Color bg;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
    decoration: BoxDecoration(
      color: bg,
      borderRadius: BorderRadius.circular(999),
    ),
    child: Text(
      text,
      style: TextStyle(color: fg, fontSize: 11, fontWeight: FontWeight.w700),
    ),
  );
}

class Avatar extends StatelessWidget {
  const Avatar(
    this.label, {
    super.key,
    this.fg = const Color(0xFF33454E),
    this.bg = AppColors.greySoft,
    this.size = 40,
  });
  final String label;
  final Color fg;
  final Color bg;
  final double size;

  @override
  Widget build(BuildContext context) => Container(
    width: size,
    height: size,
    alignment: Alignment.center,
    decoration: BoxDecoration(color: bg, shape: BoxShape.circle),
    child: Text(
      label,
      style: TextStyle(
        color: fg,
        fontWeight: FontWeight.w700,
        fontSize: size * .35,
      ),
    ),
  );
}

/// Carte blanche à bord fin, utilisée pour les listes et blocs.
class AppCard extends StatelessWidget {
  const AppCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(16),
  });
  final Widget child;
  final EdgeInsets padding;

  @override
  Widget build(BuildContext context) => Container(
    padding: padding,
    decoration: BoxDecoration(
      color: AppColors.card,
      borderRadius: BorderRadius.circular(20),
      border: Border.all(color: AppColors.line),
    ),
    child: child,
  );
}
