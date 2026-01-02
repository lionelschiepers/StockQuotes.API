# Stock Ticker API

[![TypeScript](https://img.shields.io/badge/typescript-%23007ACC.svg?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/node.js-6DA55F?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)
[![Azure Functions](https://img.shields.io/badge/azure_functions-%230062AD.svg?style=for-the-badge&logo=azure-functions&logoColor=white)](https://azure.microsoft.com/en-us/services/functions/)
[![Jest](https://img.shields.io/badge/-jest-%23C21325?style=for-the-badge&logo=jest&logoColor=white)](https://jestjs.io/)

[![Build Status](https://img.shields.io/badge/build-passing-brightgreen?style=for-the-badge)](https://github.com/your-username/your-repo/actions)
[![Code Coverage](https://codecov.io/github/lionelschiepers/StockQuotes.API/graph/badge.svg?token=LSBAP0SV2Z)](https://codecov.io/github/lionelschiepers/StockQuotes.API)

This project is the powerhouse behind the [StockQuotes.React](https://github.com/your-username/StockQuotes.React) application, providing real-time financial data through a robust and scalable API. If you're looking for a modern, well-structured, and easy-to-contribute-to financial data API, you've come to the right place!

## 🚀 Project Overview

This API serves as a dedicated backend for the [StockQuotes.React](https://github.com/your-username/StockQuotes.React) frontend, delivering up-to-date stock prices and exchange rates. It's built with TypeScript and Azure Functions, ensuring a scalable and maintainable codebase.

### ✨ Features

*   **Real-time Stock Data:** Fetches stock quotes from Yahoo Finance.
*   **Exchange Rates:** Retrieves daily euro exchange rates from the European Central Bank.
*   **Rate Limiting:** Protects the API from abuse with a custom in-memory rate limiter.
*   **Clean Architecture:** Follows a service-oriented architecture, making it easy to understand and extend.
*   **Fully Tested:** Comes with a comprehensive test suite using Jest.
*   **Modern Tooling:** Uses ESLint and Prettier for consistent code quality.

## 🛠️ Getting Started

### Prerequisites

*   [Node.js](https://nodejs.org/)
*   [Azure Functions Core Tools](https://github.com/Azure/azure-functions-core-tools)

### Installation

1.  Clone this repository:
    ```bash
    git clone https://github.com/your-username/your-repo.git
    ```
2.  Navigate to the project directory:
    ```bash
    cd your-repo
    ```
3.  Install the dependencies:
    ```bash
    npm install
    ```

### Running Locally

1.  Build the project:
    ```bash
    npm run build
    ```
2.  Start the Azure Functions host:
    ```bash
    npm start
    ```

The API will then be available at the following endpoints:

*   **Yahoo Finance:** `http://localhost:7071/api/yahoo-finance`
*   **ECB Exchange Rates:** `http://localhost:7071/api/exchange-rate-ecb`

## 🧪 Testing

This project uses [Jest](https://jestjs.io/) for both unit and integration tests.

*   Run all tests:
    ```bash
    npm test
    ```
*   Run tests in watch mode:
    ```bash
    npm test -- --watch
    ```

## 💻 Development

We follow a set of development conventions to ensure a high-quality codebase.

*   **TypeScript:** The entire project is written in TypeScript.
*   **Service-Oriented Architecture:** Business logic is encapsulated in services.
*   **Dependency Injection:** We use a simple DI container to manage service instances.
*   **Linting and Formatting:** We use ESLint and Prettier to maintain a consistent code style.
    *   `npm run lint`
    *   `npm run format`

## 🙌 Contributing

We welcome contributions of all kinds! Whether you're a seasoned developer or just starting, your help is valuable. Check out our [contributing guidelines]() to get started.

## 📄 License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.