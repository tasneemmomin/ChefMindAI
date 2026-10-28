/**
 * Ingredient API Service
 */

import { buildApiUrl } from "./apiConfig";

export async function analyzeIngredientImage(files, authToken) {
  const formData = new FormData();

  const fileList = Array.isArray(files) ? files : [files];
  for (const file of fileList) {
    if (file) {
      formData.append("images", file);
    }
  }

  const headers = {};
  if (authToken) {
    headers["Authorization"] = `Bearer ${authToken}`;
  }

  const response = await fetch(buildApiUrl("/api/ingredients/image-analyze"), {
    method: "POST",
    headers,
    body: formData,
  });

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(`Server returned status ${response.status}. Please try again.`);
  }

  if (!response.ok || !data.success) {
    throw new Error(data.message || "Image analysis failed.");
  }

  if (!Array.isArray(data.ingredients) || !Array.isArray(data.uncertainItems)) {
    throw new Error("Server returned an invalid analysis response.");
  }

  return data;
}
