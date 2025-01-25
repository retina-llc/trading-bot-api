import * as dotenv from "dotenv";
import { getTicker, getOrderBook } from "./api/api";
import WebSocket from "ws";

dotenv.config();

const ws = new WebSocket(
  "wss://ws-manager-compress.bitmart.com?protocol=1.1&symbol=BTC_USDT",
);

ws.on("message", (data: WebSocket.Data) => {
  console.log("WebSocket data:", data.toString());
});

async function main() {
  try {
    const ticker = await getTicker("BTC_USDT");
    console.log("Ticker:", ticker);

    const orderBook = await getOrderBook("BTC_USDT");
    console.log("Order Book:", orderBook);
  } catch (error) {
    console.error("Error fetching data:", error);
  }
}

main();
