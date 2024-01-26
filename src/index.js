const fs = require("fs");
const log = require("loglevel");
const N3 = require("n3");
const CryptoJS = require("crypto-js");
log.setLevel("TRACE");
// The only import we need from the Node AuthN library is the Session class.
const { Session } = require("@inrupt/solid-client-authn-node");
const { DOMParser } = require("xmldom");

const clientApplicationName = "SOLID age verification";

const express = require("express");
const { resourceUsage } = require("process");

const app = express();
const PORT = 3001;

// The HTML we return on all requests (that contains template placeholders that
// we replace as appropriate).
const indexHtml = "./src/index.html";
const markerOidcIssuer = "{{oidcIssuer}}";
const markerLoginStatus = "{{labelLoginStatus}}";
const markerLogoutStatus = "{{labelLogoutStatus}}";
const markerResourceToRead = "{{resourceToRead}}";
const markerResourceValueRetrieved = "{{resourceValueRetrieved}}";
const markerSchufaValueRetrieved = "{{resourceSchufaValueRetrieved}}";
const markerSchufaResourceToRead = "{{SchufaResourceToRead}}";

const oidcIssuer = "https://solidcommunity.net/";

const enterResourceUriMessage =
  "...but enter any resource URI to attempt to read it...";

// We expect these values to be overwritten as the users interacts!
const loggedOutStatus = "";
let resourceToRead = enterResourceUriMessage;
let SchufaResourceToRead = "Schufa Credit Score Link"
let resourceValueRetrieved = "...not read yet...";
let loginStatus = "Not logged in yet.";

let SchufaValueRetrieved = "Schufa score for resource";

// Initialised when the server comes up and is running...
let session;

app.get("/", (_req, res) => {
  loginStatus = session.info.isLoggedIn
    ? `Logged in as [${session.info.webId}]`
    : `Not logged in`;

  sendHtmlResponse(res);
});

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
          res.writeHead(302, {
            location: data,
          });
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
    next(
      new Error(
        "No OIDC issuer provided to login API (expected 'oidcIssuer' query parameter)!"
      )
    );
  }
});

app.get("/redirect", async (req, res) => {
  try {
    //log.debug(`Got redirect: [${getRequestFullUrl(req)}]`);
    await session
      .handleIncomingRedirect(getRequestFullUrl(req))
      .then((info) => {
        //log.info(`Got INFO: [${JSON.stringify(info, null, 2)}]`);
        if (info === undefined) {
          loginStatus = `Received another redirect, but we are already handling a previous redirect request - so ignoring this one!`;
          sendHtmlResponse(res);
        } else if (info.isLoggedIn) {
          resourceToRead = info.webId;
          SchufaResourceToRead = 'https://monir.solidcommunity.net/private/info/schufa.rdf';

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

app.get("/fetch", async (req, res) => {
  const resourceToFetch = req.query.resource;

  // Only attempt to fetch if the resource is not our message to enter a URI!
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
          const xmlDoc = domParser.parseFromString(
            resourceValueRetrieved,
            "text/xml"
          );
          const dob =
            xmlDoc.getElementsByTagName("dc:DateOfBirth")[0].textContent;
          if (dobValidation(bday, dob)) {
            resourceValueRetrieved = `Name: [${name}]<br>Date Of Birth: [${bday}]<br><span class="green">Date of Birth has been verified</span>`;
          } else {
            resourceValueRetrieved = `Name: [${name}]<br>Date Of Birth: [${bday}]<br> <span class="red">Date of Birth is not valid</span>`;
          }
        } catch (e) {
          resourceValueRetrieved = `Date of Birth is missing in  authority Pods`;
        }
        // log.info(`Fetch response: [${resourceValueRetrieved}]`);
      } catch (error) {
        resourceValueRetrieved = `Failed to fetch from resource [${resourceToFetch}]: ${error}`;
        //log.error(resourceValueRetrieved);
      }
    } catch (error) {
      resourceValueRetrieved = `Resource to fetch must be a valid URL - got an error parsing [${resourceToFetch}]: ${error}`;
      //log.error(resourceValueRetrieved);
    }
  }

  sendHtmlResponse(res);
});

app.get("/fetch_schufa", async (req, res) => {
  const resourceToFetch = req.query.resource;

  // Only attempt to fetch if the resource is not our message to enter a URI!
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
        console.log(SchufaValueRetrieved);
        let name;
        let verifyURL;
        let Schufa;
        const domParser = new DOMParser();
        const xmlDoc = domParser.parseFromString(
          SchufaValueRetrieved,
          "text/xml"
        );
       
       verifyURL =
          xmlDoc.getElementsByTagName("dc:verifyURL")[0].textContent;

          
        
      
        try {
          let resourceToRead2 = verifyURL;
          const response2 = await session.fetch(resourceToRead2);
          SchufaValueRetrieved = await response2.text();

          const domParser = new DOMParser();
          const xmlDoc2 = domParser.parseFromString(
            SchufaValueRetrieved,
            "text/xml"
          );
         
          const name =
          xmlDoc2.getElementsByTagName("dc:name")[0].textContent;
          const Schufa =
          xmlDoc2.getElementsByTagName("dc:schufa")[0].textContent;
            SchufaValueRetrieved = `Name: [${name}]<br>Schufa Scores: [${Schufa}]`;
          
          
        } catch (e) {
          SchufaValueRetrieved = `Schufa score is missing in  Schufa Pods`;
        }
        // log.info(`Fetch response: [${resourceValueRetrieved}]`);
      } catch (error) {
        SchufaValueRetrieved = `Failed to fetch from resource [${resourceToFetch}]: ${error}`;
        //log.error(resourceValueRetrieved);
      }
    } catch (error) {
      SchufaValueRetrieved = `Resource to fetch must be a valid URL - got an error parsing [${resourceToFetch}]: ${error}`;
      //log.error(resourceValueRetrieved);
    }
  }

  sendHtmlResponse(res);
});

app.get("/logout", async (_req, res, next) => {
  try {
    await session.logout();
    resourceToRead = enterResourceUriMessage;
    resourceValueRetrieved =
      "...nothing read yet - click 'Verify Date of Birth' button above...";

    loginStatus = `Logged out successfully.`;
    sendHtmlResponse(res);
  } catch (error) {
    log.error(`Logout processing failed: [${error}]`);
    loginStatus = `Logout processing failed: [${error}]`;
    sendHtmlResponse(res);
  }
});

app.listen(PORT, async () => {
  session = new Session();

  log.info(
    `[${clientApplicationName}] successfully initialized - listening at: [http://localhost:${PORT}]`
  );
});

function sendHtmlResponse(response) {
  response
    .writeHead(200, { "Content-Type": "text/html" })
    .write(statusIndexHtml());
  response.end();
}

function getRequestFullUrl(request) {
  return `${request.protocol}://${request.get("host")}${request.originalUrl}`;
}

function getRequestQueryParam(request, param) {
  return `${request.protocol}://${request.get("host")}${request.originalUrl}`;
}

function statusIndexHtml() {
  return fs
    .readFileSync(indexHtml, "utf8")
    .split(markerOidcIssuer)
    .join(oidcIssuer)

    .split(markerLoginStatus)
    .join(loginStatus)

    .split(markerLogoutStatus)
    .join(loggedOutStatus)

    .split(markerResourceToRead)
    .join(resourceToRead)

    .split(markerResourceValueRetrieved)
    .join(resourceValueRetrieved)

    .split(markerSchufaValueRetrieved)
    .join(SchufaValueRetrieved)

    .split(markerSchufaResourceToRead)
    .join(SchufaResourceToRead)
}

function dobValidation(dob, avaDob) {
  if (CryptoJS.MD5(dob).toString() == avaDob) return true;
  return false;
}
