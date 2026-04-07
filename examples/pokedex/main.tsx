/** @jsx h */

/**
 * main.tsx – Pokédex entry point
 *
 * Mounts the App component into the #root element.
 */

import { h } from "../../dom";
import { render } from "../../dom";
import { App } from "./App";

const root = document.getElementById("root");
if (!root) throw new Error("#root element not found");

render(() => <App />, root);
