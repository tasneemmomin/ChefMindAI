import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import app from "../app.js";
import User from "../models/User.js";

// Ensure a test JWT_SECRET exists
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-key-12345";

function startTestServer() {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      const baseUrl = `http://127.0.0.1:${port}`;
      resolve({
        baseUrl,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

test("Auth Register: Rejects invalid or missing registration fields", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    // Missing email
    const res1 = await fetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Alice", password: "password123" }),
    });
    assert.strictEqual(res1.status, 400);

    // Password < 8 characters
    const res2 = await fetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Alice", email: "alice@example.com", password: "short" }),
    });
    assert.strictEqual(res2.status, 400);

    // Invalid email format
    const res3 = await fetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Alice", email: "not-an-email", password: "password123" }),
    });
    assert.strictEqual(res3.status, 400);
    const data3 = await res3.json();
    assert.ok(data3.message.includes("valid email"));
  } finally {
    await close();
  }
});

test("Auth Register: Handles existing user duplicate conflict (409)", async () => {
  const { baseUrl, close } = await startTestServer();
  const originalFindOne = User.findOne;

  // Stub User.findOne to simulate existing user
  User.findOne = async () => ({ _id: "dummy-id", email: "existing@example.com" });

  try {
    const res = await fetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Existing User",
        email: "existing@example.com",
        password: "securepassword123",
      }),
    });
    assert.strictEqual(res.status, 409);
    const data = await res.json();
    assert.strictEqual(data.success, false);
    assert.ok(data.message.includes("already exists"));
  } finally {
    User.findOne = originalFindOne;
    await close();
  }
});

test("Auth Login: Rejects missing credentials and invalid password (401)", async () => {
  const { baseUrl, close } = await startTestServer();
  const originalFindOne = User.findOne;

  // Mock user with known hashed password
  const testPassword = "correctpassword123";
  const hashedPassword = await bcrypt.hash(testPassword, 10);

  User.findOne = () => ({
    select: async () => ({
      _id: "507f1f77bcf86cd799439011",
      name: "Bob",
      email: "bob@example.com",
      password: hashedPassword,
    }),
  });

  try {
    // Missing email
    const res1 = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "somepassword" }),
    });
    assert.strictEqual(res1.status, 400);

    // Wrong password
    const res2 = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "bob@example.com", password: "wrongpassword" }),
    });
    assert.strictEqual(res2.status, 401);
    const data2 = await res2.json();
    assert.strictEqual(data2.success, false);
    assert.ok(data2.message.includes("Invalid"));

    // Correct password
    const res3 = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "bob@example.com", password: testPassword }),
    });
    assert.strictEqual(res3.status, 200);
    const data3 = await res3.json();
    assert.strictEqual(data3.success, true);
    assert.ok(data3.token);
    assert.strictEqual(data3.user.email, "bob@example.com");
  } finally {
    User.findOne = originalFindOne;
    await close();
  }
});

test("Auth /api/auth/me: Rejects unauthenticated request and validates JWT", async () => {
  const { baseUrl, close } = await startTestServer();
  const originalFindById = User.findById;

  const fakeUserId = "507f1f77bcf86cd799439011";
  User.findById = () => ({
    select: async () => ({
      _id: fakeUserId,
      name: "Bob",
      email: "bob@example.com",
    }),
  });

  try {
    // No token -> 401
    const noTokenRes = await fetch(`${baseUrl}/api/auth/me`);
    assert.strictEqual(noTokenRes.status, 401);

    // Malformed token -> 401
    const badTokenRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: "Bearer bad-token-xyz" },
    });
    assert.strictEqual(badTokenRes.status, 401);

    // Valid token -> 200
    const validToken = jwt.sign({ userId: fakeUserId }, process.env.JWT_SECRET, { expiresIn: "1h" });
    const validRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${validToken}` },
    });
    assert.strictEqual(validRes.status, 200);
    const validData = await validRes.json();
    assert.strictEqual(validData.success, true);
    assert.strictEqual(validData.user.name, "Bob");
    assert.strictEqual(validData.user.email, "bob@example.com");
  } finally {
    User.findById = originalFindById;
    await close();
  }
});
