import 'dart:io';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:device_info_plus/device_info_plus.dart';
import 'package:battery_plus/battery_plus.dart';
import 'package:connectivity_plus/connectivity_plus.dart';

class AckService {
  final FirebaseFirestore _firestore = FirebaseFirestore.instance;

  /// ACK를 Firestore에 직접 작성
  Future<void> sendAck({
    required String messageId,
    required DateTime receivedAt,
    required String appState,
  }) async {
    try {
      // 디바이스 정보 수집
      final deviceInfo = DeviceInfoPlugin();
      String deviceModel;
      String osVersion;

      if (Platform.isAndroid) {
        final androidInfo = await deviceInfo.androidInfo;
        deviceModel = androidInfo.model;
        osVersion = 'Android ${androidInfo.version.release}';
      } else {
        final iosInfo = await deviceInfo.iosInfo;
        deviceModel = iosInfo.model;
        osVersion = iosInfo.systemVersion;
      }

      // 배터리 잔량
      final battery = Battery();
      final batteryLevel = await battery.batteryLevel;

      // 네트워크 타입
      final connectivity = Connectivity();
      final connectivityResult = await connectivity.checkConnectivity();
      final networkType = _mapNetworkType(connectivityResult);

      final ackData = {
        'messageId': messageId,
        'receivedAt': Timestamp.fromDate(receivedAt),
        'ackSentAt': FieldValue.serverTimestamp(),
        'appState': appState,
        'deviceModel': deviceModel,
        'osVersion': osVersion,
        'batteryLevel': batteryLevel,
        'networkType': networkType,
      };

      await _firestore.collection('acks').add(ackData);
      print('ACK: sent for $messageId');
    } catch (e) {
      print('ACK: failed for $messageId - $e');
    }
  }

  String _mapNetworkType(List<ConnectivityResult> results) {
    if (results.contains(ConnectivityResult.wifi)) return 'wifi';
    if (results.contains(ConnectivityResult.mobile)) return 'cellular';
    if (results.contains(ConnectivityResult.none)) return 'none';
    return 'unknown';
  }
}
