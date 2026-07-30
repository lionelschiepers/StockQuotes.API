# Stock Ticker API

## Project Overview

This project is a TypeScript-based Azure Functions application that provides financial data through two main API endpoints:

*   **Yahoo Finance:** Fetches stock quotes using the `yahoo-finance2` library.
*   **European Central Bank (ECB):** Retrieves daily euro exchange rates.

The application is designed to be scalable and resilient, incorporating features like rate limiting to prevent abuse and ensure fair usage. It uses a clean, service-oriented architecture, with business logic encapsulated in dedicated services.

## Building and Running

### Prerequisites

*   Node.js and pnpm
*   Azure Functions Core Tools

### Installation

1.  Clone the repository.
2.  Install the dependencies:

    ```bash
    pnpm install
    ```

### Running Locally

1.  Build the project:

    ```bash
    pnpm run build
    ```

2.  Start the Azure Functions host:

    ```bash
    pnpm start
    ```

The functions will be available at the following endpoints:

*   **Yahoo Finance:** `http://localhost:7071/api/yahoo-finance`
*   **ECB Exchange Rates:** `http://localhost:7071/api/exchange-rate-ecb`

### Testing

This project uses [Jest](https://jestjs.io/) for unit and integration testing. The tests are located in the `tests` directory and follow a similar structure to the `src` directory.

To run the tests, use the following command:

```bash
pnpm test
```

You can also run the tests in watch mode:

```bash
pnpm test -- --watch
```

## Development Conventions

*   **TypeScript:** The project is written entirely in TypeScript.
*   **Service-Oriented Architecture:** Business logic is separated into services, which are consumed by the Azure Functions.
*   **Dependency Injection:** A simple dependency injection container is used to manage service instances.
*   **Rate Limiting:** A custom in-memory rate limiter is used to protect the API from excessive requests.
*   **Linting and Formatting:** The project is set up with ESLint and Prettier to ensure code consistency. You can run the linter and formatter with the following commands:
    *   `pnpm run lint`
    *   `pnpm run format`

# Rules
- The project is scanned with sonarqube
- The application is developped on windows os
- Validate every fix with pnpm run lint
- Validate every fix with pnpm run format
- Validate every fix with pnpm run build
- Validate every fix with pnpm test
- Don't automatically update GIT
