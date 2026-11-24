import react from "@vitejs/plugin-react";
export default { plugins: [react()], test: { environment: "jsdom", testTimeout: 120000, hookTimeout: 180000 } };
