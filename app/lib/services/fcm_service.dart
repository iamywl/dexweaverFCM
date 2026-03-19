import 'dart:io';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:device_info_plus/device_info_plus.dart';
import 'ack_service.dart';

class FCMService {
  final FirebaseMessaging _messaging = FirebaseMessaging.instance;
  final FirebaseFirestore _firestore = FirebaseFirestore.instance;
  final AckService _ackService = AckService();

  /// FCM 초기화: 권한 요청 + 토큰 등록 + 리스너 설정
  Future<String?> initialize() async {
    // 1. 알림 권한 요청
    final settings = await _messaging.requestPermission(
      alert: true,
      badge: true,
      sound: true,
      provisional: false,
    );

    if (settings.authorizationStatus != AuthorizationStatus.authorized) {
      print('FCM: 알림 권한 거부됨');
      return null;
    }

    // 2. APNs 토큰 대기 (iOS만 해당)
    if (Platform.isIOS) {
      final apnsToken = await _messaging.getAPNSToken();
      print('FCM: APNs token = ${apnsToken?.substring(0, 20)}...');
    }

    // 3. FCM 토큰 발급
    final fcmToken = await _messaging.getToken();
    if (fcmToken != null) {
      print('FCM: token = ${fcmToken.substring(0, 20)}...');
      await _registerToken(fcmToken);
    }

    // 4. 토큰 갱신 리스너
    _messaging.onTokenRefresh.listen((newToken) async {
      print('FCM: token refreshed');
      await _registerToken(newToken);
    });

    // 5. Foreground 메시지 리스너
    FirebaseMessaging.onMessage.listen((RemoteMessage message) {
      handleMessage(message, 'foreground');
    });

    // 6. 앱이 background에서 열릴 때 (알림 탭)
    FirebaseMessaging.onMessageOpenedApp.listen((RemoteMessage message) {
      handleMessage(message, 'terminated');
    });

    // 7. Foreground에서 알림 표시 설정
    await _messaging.setForegroundNotificationPresentationOptions(
      alert: true,
      badge: true,
      sound: true,
    );

    return fcmToken;
  }

  /// Firestore에 FCM 토큰 등록
  Future<void> _registerToken(String fcmToken) async {
    final deviceInfo = DeviceInfoPlugin();

    String platform;
    String deviceModel;
    String osVersion;

    if (Platform.isAndroid) {
      final androidInfo = await deviceInfo.androidInfo;
      platform = 'android';
      deviceModel = androidInfo.model;
      osVersion = 'Android ${androidInfo.version.release}';
    } else {
      final iosInfo = await deviceInfo.iosInfo;
      platform = 'ios';
      deviceModel = iosInfo.model;
      osVersion = iosInfo.systemVersion;
    }

    await _firestore.collection('tokens').doc(fcmToken.hashCode.toString()).set(
      {
        'fcmToken': fcmToken,
        'platform': platform,
        'deviceModel': deviceModel,
        'osVersion': osVersion,
        'appVersion': '1.0.0',
        'lastActive': FieldValue.serverTimestamp(),
        'createdAt': FieldValue.serverTimestamp(),
        'isValid': true,
      },
      SetOptions(merge: true),
    );

    print('FCM: token registered to Firestore');
  }

  /// 메시지 수신 처리
  Future<void> handleMessage(RemoteMessage message, String appState) async {
    final receivedAt = DateTime.now();
    final messageId = message.data['messageId'] ?? message.messageId;

    print('FCM: received $messageId (state: $appState)');

    if (messageId != null) {
      // ACK 전송
      await _ackService.sendAck(
        messageId: messageId,
        receivedAt: receivedAt,
        appState: appState,
      );
    }
  }
}
