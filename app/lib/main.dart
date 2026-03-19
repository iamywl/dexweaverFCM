import 'package:flutter/material.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'services/fcm_service.dart';
import 'screens/home_screen.dart';

/// 백그라운드 메시지 핸들러 (top-level 함수여야 함)
@pragma('vm:entry-point')
Future<void> _firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  await Firebase.initializeApp();
  final fcmService = FCMService();
  await fcmService.handleMessage(message, 'background');
}

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Firebase.initializeApp();

  // 백그라운드 메시지 핸들러 등록
  FirebaseMessaging.onBackgroundMessage(_firebaseMessagingBackgroundHandler);

  runApp(const DexWeaverApp());
}

class DexWeaverApp extends StatelessWidget {
  const DexWeaverApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'DexWeaver FCM',
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: Colors.deepPurple),
        useMaterial3: true,
      ),
      home: const HomeScreen(),
    );
  }
}
