import "./styles/global.css";
import { createApp } from "./app/App";

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("Missing #app root.");
}

createApp(app);
