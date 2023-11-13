1. npm i
2. npm start

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
