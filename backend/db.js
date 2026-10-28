import mongoose from "mongoose";

// Connection lifecycle listeners
mongoose.connection.on("error", (err) => {
  console.error("MongoDB runtime connection error:", err.message);
});

mongoose.connection.on("disconnected", () => {
  console.warn("MongoDB connection disconnected. Awaiting reconnection...");
});

/**
 * Connect to MongoDB Atlas using Mongoose.
 */
export async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI is not configured in the environment.");
  }

  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 5000,
  });
  console.log("MongoDB connected successfully!");
}
