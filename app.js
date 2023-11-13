import express from 'express';
import {ApolloServer, gql} from 'apollo-server-express';
import {ApolloClient, InMemoryCache} from '@apollo/client/core/core.cjs';
import {createHttpLink} from "@apollo/client/link/http/http.cjs";
import fetch from 'node-fetch';

import {config} from 'dotenv';

config();

const typeDefs = gql`
    type Query {
        listRepositories: [Repository]
        fetchRepositoriesDetails(repoNames: [String!], fileType: String, owner: String): [RepositoryDetails]
    }

    type Repository {
        name: String
        size: Int
        owner: String
    }

    type RepositoryDetails {
        name: String
        size: Int
        owner: String
        visibility: String
        numberOfFiles: Int
        fileContent: String
        activeWebhooks: [Webhook]
    }
    type Webhook {
        type: String
        id: Int
        name: String
        active: Boolean
        events: [String]
        config: WebhookConfig
        updated_at: String
        created_at: String
        url: String
        test_url: String
        ping_url: String
        deliveries_url: String
        last_response: WebhookResponse
    }

    type WebhookConfig {
        content_type: String
        insecure_ssl: String
        url: String
    }

    type WebhookResponse {
        code: Int
        status: String
        message: String
    }
`;

const getFileDetailsGrapqlQuery = (repoName) => gql`
    fragment FileDetails on Tree {
        ... on Tree {
            entries {
                name
                type
                path
                object {
                    ... on Tree {
                        entries {
                            name
                            type
                            path
                        }
                    }
                }
            }
        }
    }

    query {
        viewer {
            repository(name: "${repoName}") {
                id
                name
                owner {
                    login
                }
                diskUsage
                visibility
                object(expression: "master:") {
                    ... on Tree {
                        entries {
                            name
                            type
                            path
                            object {
                                ...FileDetails
                            }
                        }
                    }
                }
            }
        }
    }
`

const getContentForSpecificFileGraphqlQuery = (repoName, fileTypePath) => gql`
    query {
        viewer {
            repository(name: "${repoName}") {
                object(expression: "master:${fileTypePath}") {
                    ... on Blob {
                        text
                    }
                }
            }
        }
    }
`

const getActiveWebhooks = async (owner, repoName) => {
    return await (await fetch(`https://api.github.com/repos/${owner}/${repoName}/hooks`, {
        headers: {'Authorization': `Bearer ${process.env.DEVELOPER_TOKEN}`},
        method: 'GET'
    })).json();
}

class GitHubAPI {
    constructor() {
        const link = createHttpLink({
            uri: 'https://api.github.com/graphql',
            fetch,
            headers: {
                Authorization: `Bearer ${process.env.DEVELOPER_TOKEN}`,
            },
        });

        this.client = new ApolloClient({
            link,
            cache: new InMemoryCache(),
        });
    }

    async query(options) {
        return this.client.query(options);
    }

    async listRepositories() {
        return await this.client.query({
            query: gql`
                query {
                    viewer {
                        repositories(last: 100) {
                            nodes {
                                name
                                diskUsage
                                owner {
                                    login
                                }
                            }
                        }
                    }
                }
            `,
        });
    }

    async fetchSingleRepositoryData(repoName, fileType, owner) {
        const response = await this.client.query({
            query: getFileDetailsGrapqlQuery(repoName),
        });

        let fileTypePath = "";

        function countBlobFiles(entry) {
            if (entry.type === "blob") {
                const entryName = entry.name;
                const lastDotIndex = entryName.lastIndexOf(".");
                const type = entryName.slice(lastDotIndex + 1);
                if (type === fileType && !fileTypePath) {
                    fileTypePath = entry.path;
                }
                return 1;
            } else if (entry.type === "tree" && entry?.object?.entries) {
                return entry.object.entries.reduce((sum, subEntry) => sum + countBlobFiles(subEntry), 0);
            } else if (entry.type === "tree") {
                return 0;
            }
            return 0;
        }

        response.numberOfFiles = response.data.viewer.repository.object?.entries.reduce((sum, entry) => sum + countBlobFiles(entry), 0);
        response.activeWebhooks = await getActiveWebhooks(owner, repoName);
        response.contentOfSpecificFile = (await this.client.query({
            query: getContentForSpecificFileGraphqlQuery(repoName, fileTypePath),
        }))?.data.viewer.repository.object?.text;

        return response;
    }
}

const resolvers = {
    Query: {
        listRepositories: async (_, __, {dataSources}) => {
            const repositoryData = await dataSources.githubAPI.listRepositories();
            return repositoryData.data.viewer.repositories.nodes.map(data => {
                return {
                    name: data.name,
                    owner: data.owner.login,
                    size: data.diskUsage
                }
            })
        },
        fetchRepositoriesDetails: async (_, {repoNames, fileType, owner}, {dataSources}) => {
            async function runMultiplePromiseAllInLoop(promises) {
                const results = [];
                for (let i = 0; i < promises.length; i += 2) {
                    results.push(await Promise.all([promises[i], promises[i + 1]]));
                }
                return results;
            }

            const promises = [];
            for (const repoName of repoNames) {
                promises.push(dataSources.githubAPI.fetchSingleRepositoryData(repoName, fileType, owner));
            }

            const result = (await runMultiplePromiseAllInLoop(promises)).flat();

            return result.filter(data => data).map(data => {
                if (data) {
                    const repo = data.data.viewer.repository;
                    return {
                        name: repo.name,
                        visibility: repo.visibility,
                        size: repo.diskUsage,
                        owner: repo.owner.login,
                        numberOfFiles: data.numberOfFiles,
                        fileContent: data.contentOfSpecificFile,
                        activeWebhooks: data.activeWebhooks
                    }
                }
            })
        },
    },
};

const main = async () => {
    const dataSources = () => ({
        githubAPI: new GitHubAPI(),
    });

    const server = new ApolloServer({
        typeDefs,
        resolvers,
        dataSources,
    });

    const app = express();
    await server.start();

    server.applyMiddleware({app});

    const PORT = process.env.PORT || 4002;

    app.listen(PORT, () => {
        console.log(`Server ready at http://localhost:${PORT}${server.graphqlPath}`);
    });
}

main();