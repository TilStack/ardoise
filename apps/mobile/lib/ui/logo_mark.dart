import 'package:flutter/material.dart';

/// Logo de L'Ardoise (ardoise à la craie sur fond orange).
class LogoMark extends StatelessWidget {
  const LogoMark({super.key, this.size = 40});
  final double size;

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(size * 0.26),
      child: Image.asset(
        'assets/logo/ardoise_icon.png',
        width: size,
        height: size,
        fit: BoxFit.cover,
        semanticLabel: "Logo L'Ardoise",
      ),
    );
  }
}
