/**
 * Creates a mock admin user in the Firebase Auth emulator and sets the admin custom claim.
 * Run with: node scripts/seed-admin-user.mjs
 * (Both the emulator AND the Next.js dev server must be running)
 */

const EMAIL = "adam.h@sols247.org"; // change this to your admin email
const PASSWORD = "demo1234";        // password you'll use to log in

async function seedAdminUser() {
  console.log(`Creating admin user: ${EMAIL}`);

  // 1. Create the user in the Auth emulator directly via REST API
  const createRes = await fetch(
    "http://localhost:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD, returnSecureToken: true }),
    }
  );

  const createData = await createRes.json();

  if (createData.error) {
    if (createData.error.message === "EMAIL_EXISTS") {
      console.log("  User already exists, skipping creation.");
    } else {
      throw new Error(`Failed to create user: ${createData.error.message}`);
    }
  } else {
    console.log(`  ✓ User created (uid: ${createData.localId})`);
  }

  // 2. Set the admin custom claim via the Next.js API route
  const claimRes = await fetch("http://localhost:3000/api/auth/set-admin-claim", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL }),
  });

  const claimData = await claimRes.json();

  if (!claimRes.ok) {
    throw new Error(`Failed to set admin claim: ${claimData.error}`);
  }

  console.log(`  ✓ Admin claim set`);
  console.log(`\nDone! You can now log in at http://localhost:3000/login`);
  console.log(`  Email:    ${EMAIL}`);
  console.log(`  Password: ${PASSWORD}`);
}

seedAdminUser().catch(console.error);
