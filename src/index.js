/**
 * This JavaScript code sets up a server using Express framework to handle authentication, fetching and
 * verifying data from Solid pods, including Schufa credit scores.
 * @param response - The `response` parameter in the code refers to the HTTP response object that is
 * used to send a response back to the client making the HTTP request. In this case, it is used to send
 * an HTML response back to the client with the status of the application.
 */
const fs = require("fs");
const log = require("loglevel");
const N3 = require("n3");
const CryptoJS = require("crypto-js");
log.setLevel("TRACE");

// Importing necessary class from Solid Client Authentication Node library
const { Session } = require("@inrupt/solid-client-authn-node");

// Importing DOMParser for XML parsing
const { DOMParser } = require("xmldom");

// Application name
const clientApplicationName = "SOLID age verification";

// Express framework for handling HTTP requests
const express = require("express");
const app = express();
const PORT = 3001;

// HTML file path containing template placeholders
const indexHtml = "./src/index.html";
const markerOidcIssuer = "{{oidcIssuer}}";
const markerLoginStatus = "{{labelLoginStatus}}";
const markerLogoutStatus = "{{labelLogoutStatus}}";
const markerResourceToRead = "{{resourceToRead}}";
const markerResourceValueRetrieved = "{{resourceValueRetrieved}}";
const markerSchufaValueRetrieved = "{{resourceSchufaValueRetrieved}}";
const markerSchufaResourceToRead = "{{SchufaResourceToRead}}";

// Default OIDC issuer
const oidcIssuer = "https://solidcommunity.net/";

// Message to enter resource URI
const enterResourceUriMessage = "...but enter any resource URI to attempt to read it...";

// Status variables initialized
let loggedOutStatus = "";
let resourceToRead = enterResourceUriMessage;
let SchufaResourceToRead = "Schufa Credit Score Link";
let resourceValueRetrieved = "...not read yet...";
let loginStatus = "Not logged in yet.";
let SchufaValueRetrieved = "Schufa score for resource";

// Session variable to be initialized when the server starts
let session;

// Handler for root endpoint
app.get("/", (_req, res) => {
  loginStatus = session.info.isLoggedIn
    ? `Logged in as [${session.info.webId}]`
    : `Not logged in`;
  sendHtmlResponse(res);
});

// Handler for login endpoint
app.get("/login", async (req, res, next) => {
  const { oidcIssuer } = req.query;

  if (session.info.isLoggedIn) {
    loginStatus = `Already logged in with WebID [${session.info.webId}].`;
    log.info(loginStatus);
    sendHtmlResponse(res);
  } else if (oidcIssuer) {
    try {
      await session.login({
        redirectUrl: "http://localhost:3001/redirect",
        oidcIssuer,
        clientName: clientApplicationName,
        handleRedirect: (data) => {
          res.writeHead(302, { location: data });
          res.end();
        },
      });

      loginStatus = `Login called, expecting redirect function to redirect the user's browser now...`;
      log.info(loginStatus);
    } catch (error) {
      loginStatus = `Login attempt failed: [${error}]`;
      log.error(loginStatus);
      sendHtmlResponse(res);
    }
  } else {
    next(new Error("No OIDC issuer provided to login API (expected 'oidcIssuer' query parameter)!"));
  }
});

// Handler for redirect endpoint
app.get("/redirect", async (req, res) => {
  try {
    await session.handleIncomingRedirect(getRequestFullUrl(req)).then((info) => {
      if (info === undefined) {
        loginStatus = `Received another redirect, but we are already handling a previous redirect request - so ignoring this one!`;
        sendHtmlResponse(res);
      } else if (info.isLoggedIn) {
        resourceToRead = info.webId;
        SchufaResourceToRead = "https://monir.solidcommunity.net/private/info/schufa.rdf";
        loginStatus = `Successfully logged in with WebID: [${info.webId}].`;
        resourceValueRetrieved = `...logged in successfully - now verify Date of Birth.`;
        sendHtmlResponse(res);
      } else {
        loginStatus = `Got redirect, but not logged in.`;
        sendHtmlResponse(res);
      }
    });
  } catch (error) {
    log.error(`Error processing redirect: [${error}]`);
    loginStatus = `Redirected, but failed to handle this as an OAuth2 redirect: [${error}]`;
    sendHtmlResponse(res);
  }
});

// Handler for fetch endpoint
app.get("/fetch", async (req, res) => {
  const resourceToFetch = req.query.resource;

  if (resourceToFetch === enterResourceUriMessage) {
    resourceValueRetrieved = "Please login to click Login button";
  } else {
    resourceToRead = resourceToFetch;

    try {
      new URL(resourceToFetch);

      try {
        const response = await session.fetch(resourceToFetch);
        responsText = await response.text();
        resourceValueRetrieved = responsText;
        let bday;
        let name;
        const parser = new N3.Parser();
        let profileInfo = parser.parse(responsText);
        Object.entries(profileInfo).forEach(([key, quad]) => {
          if (quad.predicate.id.search("#bday") > 0) {
            bday = quad.object.value;
          }
          if (quad.predicate.id.search("#fn") > 0) {
            name = quad.object.value;
          }
        });

        const { hostname } = new URL(resourceToFetch);
        let userWebId = CryptoJS.MD5(hostname).toString();
        try {
          let resourceToRead2 = `https://ava.solidcommunity.net/public/${userWebId}.rdf`;
          const response2 = await session.fetch(resourceToRead2);
          resourceValueRetrieved = await response2.text();

          const domParser = new DOMParser();
          const xmlDoc = domParser.parseFromString(resourceValueRetrieved, "text/xml");
          const dob = xmlDoc.getElementsByTagName("dc:DateOfBirth")[0].textContent;
          if (validating(bday, dob)) {
            resourceValueRetrieved = `Name: [${name}]<br>Date Of Birth: [${bday}]<br><span class="green">Date of Birth has been verified</span>`;
          } else {
            resourceValueRetrieved = `Name: [${name}]<br>Date Of Birth: [${bday}]<br> <span class="red">Date of Birth is not valid</span>`;
          }
        } catch (e) {
          resourceValueRetrieved = `Date of Birth is missing in authority Pods`;
        }
      } catch (error) {
        resourceValueRetrieved = `Failed to fetch from resource [${resourceToFetch}]: ${error}`;
      }
    } catch (error) {
      resourceValueRetrieved = `Resource to fetch must be a valid URL - got an error parsing [${resourceToFetch}]: ${error}`;
    }
  }
  sendHtmlResponse(res);
});

// Handler for Schufa fetch endpoint
app.get("/fetch_schufa", async (req, res) => {
  const resourceToFetch = req.query.resource;

  if (resourceToFetch === enterResourceUriMessage) {
    SchufaValueRetrieved = "Please login to click Login button";
  } else {
    resourceToRead = resourceToFetch;
    SchufaResourceToRead = resourceToFetch;

    try {
      new URL(resourceToFetch);

      try {
        const response = await session.fetch(resourceToFetch);
        responsText = await response.text();
        SchufaValueRetrieved = responsText;
        let name;
        let verifyURL;
        let Schufa;
        let key;
        const domParser = new DOMParser();
        const xmlDoc = domParser.parseFromString(SchufaValueRetrieved, "text/xml");
        name = xmlDoc.getElementsByTagName("dc:Name")[0].textContent;
        Schufa = xmlDoc.getElementsByTagName("dc:SchufaScore")[0].textContent;

        const { hostname } = new URL(resourceToFetch);
        let userWebId = CryptoJS.MD5(hostname).toString();

        try {
          let  verifyURL = `https://schufa.solidcommunity.net/public/${userWebId}.rdf`;
          const SchufaResponse = await session.fetch(verifyURL);
          const resData = await SchufaResponse.text();

          const domParserForSchufa = new DOMParser();
          const xmlDoc2 = domParserForSchufa.parseFromString(resData, "text/xml");
          const score = xmlDoc2.getElementsByTagName("dc:score")[0].textContent;
          if (validating(Schufa, score)) {
            SchufaValueRetrieved = `Name: [${name}]<br>Schufa score is: [${Schufa}]<br><span class="green">Schufa score has been verified</span>`;
          } else {
            SchufaValueRetrieved = `Name: [${name}]<br>Schufa score is: [${Schufa}]<br> <span class="red">Schufa score is not valid</span>`;
          }
        } catch (e) {
          SchufaValueRetrieved = `Schufa score is missing in Schufa Pods` + e;
        }
      } catch (error) {
        SchufaValueRetrieved = `Failed to fetch from resource [${resourceToFetch}]: ${error}`;
      }
    } catch (error) {
      SchufaValueRetrieved = `Resource to fetch must be a valid URL - got an error parsing [${resourceToFetch}]: ${error}`;
    }
  }
  sendHtmlResponse(res);
});

// Handler for logout endpoint
app.get("/logout", async (_req, res, next) => {
  try {
    await session.logout();
    resourceToRead = enterResourceUriMessage;
    resourceValueRetrieved = "...nothing read yet - click 'Verify Date of Birth' button above...";
    loginStatus = `Logged out successfully.`;
    sendHtmlResponse(res);
  } catch (error) {
    log.error(`Logout processing failed: [${error}]`);
    loginStatus = `Logout processing failed: [${error}]`;
    sendHtmlResponse(res);
  }
});

// Start the server
app.listen(PORT, async () => {
  session = new Session();
  log.info(`[${clientApplicationName}] successfully initialized - listening at: [http://localhost:${PORT}]`);
});

// Function to send HTML response
function sendHtmlResponse(response) {
  response
    .writeHead(200, { "Content-Type": "text/html" })
    .write(statusIndexHtml());
  response.end();
}

// Function to get full URL from request
function getRequestFullUrl(request) {
  return `${request.protocol}://${request.get("host")}${request.originalUrl}`;
}

// Function to get query parameter from request
function getRequestQueryParam(request, param) {
  return `${request.protocol}://${request.get("host")}${request.originalUrl}`;
}

// Function to replace placeholders in HTML template with actual values
function statusIndexHtml() {
  return fs
    .readFileSync(indexHtml, "utf8")
    .split(markerOidcIssuer).join(oidcIssuer)
    .split(markerLoginStatus).join(loginStatus)
    .split(markerLogoutStatus).join(loggedOutStatus)
    .split(markerResourceToRead).join(resourceToRead)
    .split(markerResourceValueRetrieved).join(resourceValueRetrieved)
    .split(markerSchufaValueRetrieved).join(SchufaValueRetrieved)
    .split(markerSchufaResourceToRead).join(SchufaResourceToRead);
}

// Function to validate date of birth
function validating(personalPodInfo, authorityPodInfo) {
  return CryptoJS.MD5(personalPodInfo).toString() === authorityPodInfo;
}

// Encryption function
function encryptData(data, key) {
  return CryptoJS.AES.encrypt(data, key).toString();
}

// Decryption function
function decryptData(encryptedData, key) {
  return CryptoJS.AES.decrypt(encryptedData, key).toString(CryptoJS.enc.Utf8);
}
