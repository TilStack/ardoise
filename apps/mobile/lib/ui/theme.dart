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

  // Thème sombre
  static const darkPaper = Color(0xFF12181C);
  static const darkCard = Color(0xFF1B252B);
  static const darkField = Color(0xFF26323A);
  static const darkLine = Color(0xFF2E3B44);
  static const darkInk = Color(0xFFEDE9E0);
}

/// Couleurs de structure qui changent entre le thème clair et le thème sombre.
extension ThemeColors on BuildContext {
  bool get isDark => Theme.of(this).brightness == Brightness.dark;

  /// Fond des cartes, champs et barres.
  Color get cardSurface => isDark ? AppColors.darkCard : Colors.white;

  /// Fin trait de séparation.
  Color get hairline => isDark ? AppColors.darkLine : AppColors.line;

  /// Fond des zones discrètes (boutons secondaires, onglets).
  Color get fieldTint => isDark ? AppColors.darkField : AppColors.field;

  /// Texte principal.
  Color get inkColor => isDark ? AppColors.darkInk : AppColors.ink;
}

ThemeData buildTheme({String? fontFamily, bool dark = false}) {
  final paper = dark ? AppColors.darkPaper : AppColors.paper;
  final ink = dark ? AppColors.darkInk : AppColors.ink;
  final surface = dark ? AppColors.darkCard : Colors.white;
  final line = dark ? AppColors.darkLine : const Color(0xFFE3DED3);
  final base = ThemeData(
    useMaterial3: true,
    brightness: dark ? Brightness.dark : Brightness.light,
    fontFamily: fontFamily,
    colorSchemeSeed: AppColors.slate,
    scaffoldBackgroundColor: paper,
  );
  return base.copyWith(
    colorScheme: base.colorScheme.copyWith(
      primary: dark ? AppColors.chalk : AppColors.slate,
      secondary: AppColors.orange,
      surface: paper,
    ),
    appBarTheme: AppBarTheme(
      backgroundColor: paper,
      foregroundColor: ink,
      elevation: 0,
      scrolledUnderElevation: 0,
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: surface,
      indicatorColor: dark ? AppColors.darkField : AppColors.field,
    ),
    dialogTheme: DialogThemeData(backgroundColor: surface),
    textTheme: base.textTheme.apply(bodyColor: ink, displayColor: ink),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: surface,
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 16),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: BorderSide(color: line, width: 1.5),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: BorderSide(color: line, width: 1.5),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: BorderSide(
          color: dark ? AppColors.chalk : AppColors.slate,
          width: 1.5,
        ),
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
      color: context.cardSurface,
      borderRadius: BorderRadius.circular(20),
      border: Border.all(color: context.hairline),
    ),
    child: child,
  );
}
