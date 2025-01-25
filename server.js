const express = require("express");
const path = require("path");
const bodyParser = require("body-parser");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware to parse JSON bodies
app.use(bodyParser.json());

// Serve static files from the "public" directory
app.use(express.static(path.join(__dirname, "public")));

// Endpoint to handle the start trade request
app.post("/trading/start-trade", (req, res) => {
  const { symbol, amount, rebuyPercentage, profitTarget } = req.body;
  console.log("Trade request received:", {
    symbol,
    amount,
    rebuyPercentage,
    profitTarget,
  });
  res.json({
    message: "Trade started successfully",
    data: { symbol, amount, rebuyPercentage, profitTarget },
  });
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
