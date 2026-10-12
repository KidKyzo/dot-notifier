import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import MotionLab from "./MotionLab";

const isMotionLab = import.meta.env.DEV
  && import.meta.env.MODE === "mock"
  && new URLSearchParams(window.location.search).has("motion-lab");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isMotionLab ? <MotionLab /> : <App />}
  </React.StrictMode>,
);
