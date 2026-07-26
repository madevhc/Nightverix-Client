import { BrowserRouter } from "react-router-dom";
import { ThemeProvider } from "./ThemeProvider";
import { RunningInstancesProvider } from "./RunningInstancesContext";
import MainLayout from "./layout/MainLayout";

export default function App() {
  return (
    <ThemeProvider>
      <RunningInstancesProvider>
        <BrowserRouter>
          <MainLayout />
        </BrowserRouter>
      </RunningInstancesProvider>
    </ThemeProvider>
  );
}
