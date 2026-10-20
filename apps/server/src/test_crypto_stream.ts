import { app } from "./index";

async function testCryptoStream() {
  console.log("Testing encrypted streaming route with Range header...");
  // Query a post
  const feedRes = await app.handle(new Request("http://localhost:3001/api/feed"));
  const feedData = await feedRes.json();
  const testPost = feedData.items[0];

  const streamRes = await app.handle(new Request(`http://localhost:3001/api/media/${testPost.id}/stream`, {
    headers: { Range: "bytes=0-15" }
  }));

  console.log("Status:", streamRes.status);
  console.log("Content-Range header:", streamRes.headers.get("Content-Range"));
  const decryptedBytes = await streamRes.arrayBuffer();
  const text = new TextDecoder().decode(decryptedBytes);
  console.log("Decrypted slice content:", text);
}

testCryptoStream();
