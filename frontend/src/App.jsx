import { useState, useEffect, useCallback } from "react";
import "./App.css";
import Auth from "./Auth";
import Navbar from "./components/Navbar";
import Hero from "./components/Hero";
import IngredientSection from "./components/IngredientSection";
import IngredientConfirmation from "./components/IngredientConfirmation";
import PreferencesSection from "./components/PreferencesSection";
import RecipeResult from "./components/RecipeResult";
import Cookbook from "./components/Cookbook";
import Footer from "./components/Footer";
import {
  generateRecipe as generateRecipeAPI,
  fetchRecipes,
  toggleRecipeFavorite,
  deleteRecipe as deleteRecipeAPI,
  saveCustomRecipe as saveCustomRecipeAPI,
} from "./services/recipeService";
import { getCurrentUser } from "./services/authService";

function App() {
  const [currentUser, setCurrentUser] = useState(() => {
    try {
      const savedUser = localStorage.getItem("chefmind_user");
      return savedUser ? JSON.parse(savedUser) : null;
    } catch {
      return null;
    }
  });

  const [authToken, setAuthToken] = useState(() => {
    return localStorage.getItem("chefmind_token") || "";
  });

  const [inputMode, setInputMode] = useState("text");
  const [ingredients, setIngredients] = useState("");

  // Ingredient confirmation workflow states
  const [userIngredients, setUserIngredients] = useState([]);
  const [confirmedIngredients, setConfirmedIngredients] = useState([]);
  const [isConfirmed, setIsConfirmed] = useState(false);
  const [uncertainSuggestions, setUncertainSuggestions] = useState([]);
  const [observations, setObservations] = useState("");

  const [meal, setMeal] = useState("Dinner");
  const [cuisine, setCuisine] = useState("Any cuisine");
  const [diet, setDiet] = useState("No preference");
  const [cookingTime, setCookingTime] = useState("30");
  const [servings, setServings] = useState("2");
  const [spiceLevel, setSpiceLevel] = useState("No preference");
  const [cookingInstructions, setCookingInstructions] = useState("");
  const [language, setLanguage] = useState("English");

  const [recipe, setRecipe] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [savedRecipes, setSavedRecipes] = useState([]);
  const [loadingRecipes, setLoadingRecipes] = useState(false);
  const [cookbookError, setCookbookError] = useState("");

  const handleLogout = useCallback(() => {
    localStorage.removeItem("chefmind_token");
    localStorage.removeItem("chefmind_user");
    setAuthToken("");
    setCurrentUser(null);
    setRecipe(null);
    setSavedRecipes([]);
    setUserIngredients([]);
    setConfirmedIngredients([]);
    setIsConfirmed(false);
    setUncertainSuggestions([]);
    setObservations("");
    setSpiceLevel("No preference");
    setCookingInstructions("");
    setLanguage("English");
    setError("");
    setCookbookError("");
  }, []);

  // Verify and sync user session on mount
  useEffect(() => {
    if (!authToken) return;

    let isMounted = true;
    getCurrentUser(authToken)
      .then((data) => {
        if (isMounted && data.user) {
          setCurrentUser(data.user);
          localStorage.setItem("chefmind_user", JSON.stringify(data.user));
        }
      })
      .catch((err) => {
        console.warn("Session expired or invalid:", err.message);
        if (isMounted) {
          handleLogout();
        }
      });

    return () => {
      isMounted = false;
    };
  }, [authToken, handleLogout]);

  // Load initial cookbook recipes
  useEffect(() => {
    if (!authToken) return;

    const controller = new AbortController();

    async function loadInitialCookbook() {
      setLoadingRecipes(true);
      setCookbookError("");

      try {
        const recipes = await fetchRecipes(authToken, controller.signal);
        setSavedRecipes(recipes);
      } catch (err) {
        if (err.name !== "AbortError") {
          if (err.message.toLowerCase().includes("token") || err.message.toLowerCase().includes("log in")) {
            handleLogout();
          } else {
            setCookbookError(err.message || "Failed to load your cookbook.");
          }
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoadingRecipes(false);
        }
      }
    }

    loadInitialCookbook();

    return () => controller.abort();
  }, [authToken, handleLogout]);

  async function handleLoadRecipes() {
    if (!authToken || loadingRecipes) return;

    setLoadingRecipes(true);
    setCookbookError("");

    try {
      const recipes = await fetchRecipes(authToken);
      setSavedRecipes(recipes);
    } catch (err) {
      console.error("Loading recipes failed:", err);
      if (err.message.toLowerCase().includes("token") || err.message.toLowerCase().includes("log in")) {
        handleLogout();
      } else {
        setCookbookError(err.message || "Failed to load recipes.");
      }
    } finally {
      setLoadingRecipes(false);
    }
  }

  async function handleToggleFavorite(id) {
    if (!authToken) return;

    try {
      const updated = await toggleRecipeFavorite(id, authToken);
      setSavedRecipes((prev) =>
        prev.map((item) => (item._id === id ? updated : item))
      );
    } catch (err) {
      console.error("Favorite update failed:", err);
      if (err.message.toLowerCase().includes("token") || err.message.toLowerCase().includes("log in")) {
        handleLogout();
      } else {
        setCookbookError(err.message || "Could not update favorite.");
      }
    }
  }

  async function handleDeleteRecipe(id) {
    if (!authToken) return;

    try {
      await deleteRecipeAPI(id, authToken);
      setSavedRecipes((prev) => prev.filter((item) => item._id !== id));
    } catch (err) {
      console.error("Recipe deletion failed:", err);
      if (err.message.toLowerCase().includes("token") || err.message.toLowerCase().includes("log in")) {
        handleLogout();
      } else {
        setCookbookError(err.message || "Could not delete recipe.");
      }
      throw err;
    }
  }

  const handleImageAnalysisSuccess = useCallback((data) => {
    const detected = Array.isArray(data.ingredients) ? data.ingredients : [];
    const uncertain = Array.isArray(data.uncertainItems) ? data.uncertainItems : [];
    setUserIngredients([...detected]);
    setUncertainSuggestions([...uncertain]);
    setObservations(data.observations || "");
    setConfirmedIngredients([]);
    setIsConfirmed(false);
    setIngredients(detected.join(", "));
  }, []);

  const handleReviewInput = useCallback((parsedList) => {
    setUserIngredients([...parsedList]);
    setUncertainSuggestions([]);
    setObservations("");
    setConfirmedIngredients([]);
    setIsConfirmed(false);
  }, []);

  const handleUserIngredientsChange = useCallback((newList) => {
    setUserIngredients(newList);
    setIsConfirmed(false);
    setConfirmedIngredients([]);
  }, []);

  const handleUncertainItemsChange = useCallback((newUncertainList) => {
    setUncertainSuggestions(newUncertainList);
  }, []);

  const handleConfirmIngredients = useCallback((finalList) => {
    setConfirmedIngredients([...finalList]);
    setIsConfirmed(true);
    setIngredients(finalList.join(", "));
    setError("");
  }, []);

  const handleUnlockIngredients = useCallback(() => {
    setIsConfirmed(false);
  }, []);

  const handleBackToStep01 = useCallback(() => {
    const el = document.getElementById("step-01-heading");
    if (el) el.scrollIntoView({ behavior: "smooth" });
  }, []);

  async function handleSubmit(event) {
    event.preventDefault();

    if (loading) return;

    if (!isConfirmed || confirmedIngredients.length === 0) {
      setError("Please review and click 'Confirm ingredients' in Step 02 before generating your recipe.");
      const el = document.getElementById("ingredient-confirmation-step");
      if (el) el.scrollIntoView({ behavior: "smooth" });
      return;
    }

    setLoading(true);
    setError("");
    setRecipe(null);

    try {
      const finalPayload = confirmedIngredients.join(", ");
      const newRecipe = await generateRecipeAPI(
        {
          ingredients: finalPayload,
          meal,
          cuisine,
          diet,
          cookingTime,
          servings,
          spiceLevel,
          cookingInstructions: cookingInstructions.trim(),
          language,
        },
        authToken
      );

      setRecipe(newRecipe);
      setSavedRecipes((prev) => [newRecipe, ...prev]);
    } catch (err) {
      console.error("Recipe generation failed:", err);
      if (err.message.toLowerCase().includes("token") || err.message.toLowerCase().includes("log in")) {
        handleLogout();
      } else {
        setError(err.message || "Something went wrong.");
      }
    } finally {
      setLoading(false);
    }
  }

  function handleLoginSuccess(data) {
    localStorage.setItem("chefmind_token", data.token);
    localStorage.setItem("chefmind_user", JSON.stringify(data.user));
    setCurrentUser(data.user);
    setAuthToken(data.token);
  }

  if (!authToken || !currentUser) {
    return <Auth onLogin={handleLoginSuccess} />;
  }

  return (
    <main className="app">
      <Navbar currentUser={currentUser} onLogout={handleLogout} />

      <Hero />

      <form className="recipe-card" onSubmit={handleSubmit}>
        <IngredientSection
          ingredients={ingredients}
          setIngredients={setIngredients}
          inputMode={inputMode}
          setInputMode={setInputMode}
          onError={setError}
          authToken={authToken}
          onImageAnalysisSuccess={handleImageAnalysisSuccess}
          onReviewInput={handleReviewInput}
        />

        <div className="section-divider" />

        <IngredientConfirmation
          items={userIngredients}
          onItemsChange={handleUserIngredientsChange}
          uncertainItems={uncertainSuggestions}
          onUncertainItemsChange={handleUncertainItemsChange}
          isConfirmed={isConfirmed}
          onConfirm={handleConfirmIngredients}
          onUnlock={handleUnlockIngredients}
          onBackToEdit={handleBackToStep01}
          observations={observations}
          disabled={loading}
        />

        <div className="section-divider" />

        <PreferencesSection
          meal={meal}
          setMeal={setMeal}
          cuisine={cuisine}
          setCuisine={setCuisine}
          diet={diet}
          setDiet={setDiet}
          cookingTime={cookingTime}
          setCookingTime={setCookingTime}
          servings={servings}
          setServings={setServings}
          language={language}
          setLanguage={setLanguage}
          spiceLevel={spiceLevel}
          setSpiceLevel={setSpiceLevel}
          cookingInstructions={cookingInstructions}
          setCookingInstructions={setCookingInstructions}
          loading={loading}
          isConfirmed={isConfirmed}
          confirmedCount={confirmedIngredients.length}
        />
      </form>

      <RecipeResult
        loading={loading}
        error={error}
        recipe={recipe}
        authToken={authToken}
        onApplyRecipeUpdate={(updated) => {
          setRecipe(updated);
        }}
        onSaveCustomRecipe={async (recipeToSave) => {
          const saved = await saveCustomRecipeAPI(recipeToSave, authToken);
          setSavedRecipes((prev) => [saved, ...prev]);
          return saved;
        }}
      />

      <Cookbook
        recipes={savedRecipes}
        loading={loadingRecipes}
        error={cookbookError}
        onLoadRecipes={handleLoadRecipes}
        onToggleFavorite={handleToggleFavorite}
        onDeleteRecipe={handleDeleteRecipe}
      />

      <Footer />
    </main>
  );
}

export default App;
