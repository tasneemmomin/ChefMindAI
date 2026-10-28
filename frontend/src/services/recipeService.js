/**
 * Recipe API Service
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

export async function generateRecipe(params, authToken) {
  const response = await fetch(buildApiUrl("/api/recipes/generate"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify(params),
  });

  const data = await parseJsonResponse(response, "Unable to generate your recipe.");
  return data.recipe;
}

export async function fetchRecipes(authToken, signal) {
  const response = await fetch(buildApiUrl("/api/recipes"), {
    headers: {
      Authorization: `Bearer ${authToken}`,
    },
    signal,
  });

  const data = await parseJsonResponse(response, "Failed to load your cookbook.");
  return Array.isArray(data) ? data : data.recipes ?? [];
}

export async function toggleRecipeFavorite(id, authToken) {
  const response = await fetch(buildApiUrl(`/api/recipes/${id}/favorite`), {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${authToken}`,
    },
  });

  const data = await parseJsonResponse(response, "Could not update favorite.");
  return data.recipe;
}

export async function deleteRecipe(id, authToken) {
  const response = await fetch(buildApiUrl(`/api/recipes/${id}`), {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${authToken}`,
    },
  });

  return parseJsonResponse(response, "Could not delete recipe.");
}

export async function sendRecipeChatMessage({ recipeId, recipe, message, history }, authToken) {
  const endpoint = recipeId ? `/api/recipes/${recipeId}/chat` : "/api/recipes/chat";
  const response = await fetch(buildApiUrl(endpoint), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify({
      message,
      history,
      recipe,
      recipeId,
    }),
  });

  const data = await parseJsonResponse(response, "Failed to get response from cooking assistant.");
  return data.response;
}

export async function saveCustomRecipe(recipe, authToken) {
  const response = await fetch(buildApiUrl("/api/recipes/save"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify({ recipe }),
  });

  const data = await parseJsonResponse(response, "Unable to save custom recipe.");
  return data.recipe;
}

