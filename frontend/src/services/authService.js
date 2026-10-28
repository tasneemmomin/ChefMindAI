/**
 * Auth API Service
 */

import { buildApiUrl } from "./apiConfig";

async function parseJsonResponse(response, defaultError = "Request failed.") {
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(`Server returned status ${response.status}. Please try again.`);
  }

  if (!response.ok || !data?.success) {
    throw new Error(data?.message || defaultError);
  }

  return data;
}

export async function loginUser(email, password) {
  const response = await fetch(buildApiUrl("/api/auth/login"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });

  return parseJsonResponse(response, "Login failed.");
}

export async function registerUser(name, email, password) {
  const response = await fetch(buildApiUrl("/api/auth/register"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name, email, password }),
  });

  return parseJsonResponse(response, "Registration failed.");
}

export async function getCurrentUser(token) {
  const response = await fetch(buildApiUrl("/api/auth/me"), {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  return parseJsonResponse(response, "Failed to fetch user session.");
}

