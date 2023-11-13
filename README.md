1. npm i
2. npm start

Then click query your server:
![Logo](Screenshot%202023-11-13%20at%2022.42.44.png)

Example of usage:

query {
  listRepositories {
    name
    size
    owner
  }
  fetchRepositoriesDetails(repoNames: ["repo1", "repo2", "repo3"], fileType: "yml", owner: "user") {
    name
    size
    owner
    visibility
    numberOfFiles
    fileContent
    activeWebhooks {
      id
    }
  }
}
