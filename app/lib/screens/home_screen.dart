import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import '../services/fcm_service.dart';
import '../models/message_model.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final FCMService _fcmService = FCMService();
  String? _fcmToken;
  final List<ReceivedMessage> _messages = [];

  @override
  void initState() {
    super.initState();
    _initFCM();
  }

  Future<void> _initFCM() async {
    final token = await _fcmService.initialize();
    setState(() => _fcmToken = token);

    // Foreground 메시지 UI 업데이트용 리스너
    FirebaseMessaging.onMessage.listen((RemoteMessage message) {
      final msg = ReceivedMessage(
        messageId: message.data['messageId'] ?? message.messageId ?? 'unknown',
        title: message.notification?.title ?? message.data['title'],
        body: message.notification?.body ?? message.data['body'],
        receivedAt: DateTime.now(),
        appState: 'foreground',
        data: message.data,
      );
      setState(() => _messages.insert(0, msg));
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('DexWeaver FCM'),
        backgroundColor: Theme.of(context).colorScheme.inversePrimary,
        actions: [
          IconButton(
            icon: const Icon(Icons.copy),
            tooltip: 'Copy FCM Token',
            onPressed: _fcmToken != null
                ? () {
                    Clipboard.setData(ClipboardData(text: _fcmToken!));
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(content: Text('FCM Token copied!')),
                    );
                  }
                : null,
          ),
        ],
      ),
      body: Column(
        children: [
          // FCM Token 표시
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(12),
            color: Colors.grey[100],
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'FCM Token:',
                  style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12),
                ),
                const SizedBox(height: 4),
                Text(
                  _fcmToken != null
                      ? '${_fcmToken!.substring(0, 40)}...'
                      : 'Loading...',
                  style: const TextStyle(fontSize: 11, fontFamily: 'monospace'),
                ),
              ],
            ),
          ),
          // 수신 카운터
          Padding(
            padding: const EdgeInsets.all(8.0),
            child: Text(
              'Received: ${_messages.length} messages',
              style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
            ),
          ),
          const Divider(),
          // 메시지 리스트
          Expanded(
            child: _messages.isEmpty
                ? const Center(child: Text('No messages yet'))
                : ListView.builder(
                    itemCount: _messages.length,
                    itemBuilder: (context, index) {
                      final msg = _messages[index];
                      return ListTile(
                        leading: Icon(
                          _stateIcon(msg.appState),
                          color: _stateColor(msg.appState),
                        ),
                        title: Text(msg.title ?? 'No title'),
                        subtitle: Text(
                          '${msg.messageId.substring(0, 8)}... | ${msg.appState}',
                          style: const TextStyle(fontSize: 12),
                        ),
                        trailing: Text(
                          '${msg.receivedAt.hour}:${msg.receivedAt.minute.toString().padLeft(2, '0')}:${msg.receivedAt.second.toString().padLeft(2, '0')}',
                          style: const TextStyle(fontSize: 11),
                        ),
                      );
                    },
                  ),
          ),
        ],
      ),
    );
  }

  IconData _stateIcon(String state) {
    switch (state) {
      case 'foreground':
        return Icons.visibility;
      case 'background':
        return Icons.visibility_off;
      case 'terminated':
        return Icons.power_settings_new;
      default:
        return Icons.question_mark;
    }
  }

  Color _stateColor(String state) {
    switch (state) {
      case 'foreground':
        return Colors.green;
      case 'background':
        return Colors.orange;
      case 'terminated':
        return Colors.red;
      default:
        return Colors.grey;
    }
  }
}
