// models/User.js
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const MovieListItemSchema = new mongoose.Schema({
  imdbId: {
    type: String,
    required: true,
    trim: true
  },
  title: {
    type: String,
    required: true,
    trim: true
  },
  poster: String,
  releaseDate: String,
  rating: Number,
  runtime: String,
  overview: String,
  addedAt: {
    type: Date,
    default: Date.now
  }
}, { _id: false });

const listSchemaDefinition = {
  watched: { type: [MovieListItemSchema], default: [] },
  watching: { type: [MovieListItemSchema], default: [] },
  planned: { type: [MovieListItemSchema], default: [] },
  onhold: { type: [MovieListItemSchema], default: [] },
  dropped: { type: [MovieListItemSchema], default: [] }
};

const UserSchema = new mongoose.Schema({
  name: {
    type: String,
    trim: true,
    required: [true, "Name is required"],
    maxlength: 100
  },
  email: {
    type: String,
    required: [true, "Email required"],
    unique: true,
    lowercase: true,
    trim: true
  },
  password: {
    type: String,
    required: [true, "Password required"],
    minlength: 6
  },
  role: {
    type: String,
    enum: ["user", "admin"],
    default: "user"
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  lists: {
    type: listSchemaDefinition,
    default: () => ({
      watched: [],
      watching: [],
      planned: [],
      onhold: [],
      dropped: []
    })
  }
}, { timestamps: true });

// Hash password before save (only if modified)
UserSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Instance method to compare password
UserSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model("User", UserSchema);
