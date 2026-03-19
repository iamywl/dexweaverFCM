/**
 * 토큰 등록 스크립트
 * 사용법: npm run register-token -- --token <FCM_TOKEN>
 *
 * Flutter 앱이 콘솔에 출력한 FCM 토큰을 Firestore에 수동 등록할 때 사용.
 * 앱에서 자동 등록하므로 보통은 필요 없지만, 디버깅/테스트용으로 유용.
 */
import { db } from "../config/firebase";

async function registerToken() {
  const args = process.argv.slice(2);
  const tokenIdx = args.indexOf("--token");
  if (tokenIdx === -1 || !args[tokenIdx + 1]) {
    console.error("Usage: npm run register-token -- --token <FCM_TOKEN>");
    process.exit(1);
  }

  const fcmToken = args[tokenIdx + 1];

  const tokenDoc = {
    fcmToken,
    platform: "ios",
    deviceModel: args[args.indexOf("--device") + 1] || "iPhone",
    osVersion: args[args.indexOf("--os") + 1] || "unknown",
    appVersion: "1.0.0",
    lastActive: new Date(),
    createdAt: new Date(),
    isValid: true,
  };

  const docRef = await db.collection("tokens").add(tokenDoc);
  console.log(`Token registered: ${docRef.id}`);
  console.log(`FCM Token: ${fcmToken.substring(0, 20)}...`);
  process.exit(0);
}

registerToken().catch(console.error);
