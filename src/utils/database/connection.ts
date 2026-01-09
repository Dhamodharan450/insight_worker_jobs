export const createConnectionString = (dbConfig: any, dbName: string) => {
  if (dbName === 'mssql' || dbName === 'mariadb') {
    const { database, host, password, port, user, username } = dbConfig;
    return `mysql+pymysql://${encodeURIComponent(user || username)}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
  } else if (dbName === 'postgresql' || dbName === 'redshift') {
    const { database, host, password, port, user, dbname } = dbConfig;
    return `postgresql://${user}:${password}@${host.trim()}:${port}/${database || dbname}`;
  } else if (dbName === 'mssql') {
    const { database, host, password, port, username } = dbConfig;
    console.log(port);
    return `DRIVER={ODBC Driver 17 for SQL Server};SERVER=${host};DATABASE=${database};UID=${username};PWD=${password}`;
  } else if (dbName === 'snowflake') {
    const { user, password, account, warehouse, database, role } = dbConfig;
    return `snowflake://${user}:${password}@${account}/${database}?warehouse=${warehouse}&role=${role}`;
  } else if (dbName === 'mongodb') {
    return constructConnStringForMongo(dbConfig);
  } else if (dbName === 'databricks') {
    const { token, host, path } = dbConfig;
    return JSON.stringify({ token, host, path });
  } else if (dbName === 'bigquery') {
    return JSON.parse(dbConfig?.json_credentials);
  } else {
    return '';
  }
};

export const constructConnStringForMongo = (connection: any): string => {
  const auth =
    connection.user && connection.password
      ? `${encodeURIComponent(connection.user)}:${encodeURIComponent(connection.password)}@`
      : '';
  const connectionString = `mongodb${connection.srv ? '+srv' : ''}://${auth}${connection.host}/${connection.database}`;
  const params = [];
  if (connection.authSource) {
    params.push(`authSource=${connection.authSource}`);
  }
  if (connection.ssl !== false) {
    params.push('ssl=true');
  }
  return params.length > 0
    ? `${connectionString}?${params.join('&')}`
    : connectionString;
};
