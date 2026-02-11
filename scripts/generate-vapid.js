import { generateVAPIDKeys } from "web-push-browser";

generateVAPIDKeys().then(({ publicKey, privateKey }) => {
  console.log("VAPID Keys Generated:\n");
  console.log("Public Key:", publicKey);
  console.log("Private Key:", privateKey);
  console.log("\nNext steps:");
  console.log("1. Put public key in wrangler.toml [vars] VAPID_PUBLIC_KEY");
  console.log("2. Run: npx wrangler secret put VAPID_PRIVATE_KEY");
  console.log("   Then paste the private key above");
});
