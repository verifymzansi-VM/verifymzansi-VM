import type { Preview } from "@storybook/react";
import "../src/styles/globals.css";

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    backgrounds: {
      default: "light",
      values: [
        { name: "light", value: "#faf8f5" },
        { name: "dark", value: "#1a1714" },
      ],
    },
    a11y: {
      config: {
        rules: [
          // Default rules — axe-core runs automatically per story
        ],
      },
    },
  },
  decorators: [
    (Story) => (
      <div className="min-h-screen font-sans antialiased">
        <Story />
      </div>
    ),
  ],
};

export default preview;
