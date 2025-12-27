# Stock Ticker API

## Project Overview

This project is a TypeScript-based Azure Functions application that provides financial data through two main API endpoints:

*   **Yahoo Finance:** Fetches stock quotes using the `yahoo-finance2` library.
*   **European Central Bank (ECB):** Retrieves daily euro exchange rates.

The application is designed to be scalable and resilient, incorporating features like rate limiting to prevent abuse and ensure fair usage. It uses a clean, service-oriented architecture, with business logic encapsulated in dedicated services.

## Building and Running

### Prerequisites

*   Node.js
*   Azure Functions Core Tools

### Installation

1.  Clone the repository.
2.  Install the dependencies:

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

The functions will be available at the following endpoints:

*   **Yahoo Finance:** `http://localhost:7071/api/yahoo-finance`
*   **ECB Exchange Rates:** `http://localhost:7071/api/exchange-rate-ecb`

### Testing

There are currently no automated tests. To add tests, you would run:

```bash
npm test
```

## Development Conventions

*   **TypeScript:** The project is written entirely in TypeScript.
*   **Service-Oriented Architecture:** Business logic is separated into services, which are consumed by the Azure Functions.
*   **Dependency Injection:** A simple dependency injection container is used to manage service instances.
*   **Rate Limiting:** A custom in-memory rate limiter is used to protect the API from excessive requests.
*   **Linting and Formatting:** The project should be set up with a linter and formatter (e.g., ESLint, Prettier) to ensure code consistency. (TODO: Add linting and formatting scripts to `package.json`).
