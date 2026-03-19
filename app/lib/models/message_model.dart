class ReceivedMessage {
  final String messageId;
  final String? title;
  final String? body;
  final DateTime receivedAt;
  final String appState;
  final Map<String, dynamic> data;

  ReceivedMessage({
    required this.messageId,
    this.title,
    this.body,
    required this.receivedAt,
    required this.appState,
    this.data = const {},
  });

  @override
  String toString() {
    return '[$appState] $messageId: ${title ?? "no title"} - ${body ?? "no body"}';
  }
}
