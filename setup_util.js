const fs = require('fs-extra');
const readline = require('readline');
const { google } = require('googleapis');
const path_lib = require('path');
const moment = require('moment');

const SCOPES = ['https://www.googleapis.com/auth/drive'];
const TOKEN_PATH = './credentials.json';

var main = async (folder) => {
  var auth = await authen();
  let drive = google.drive({ version: 'v3', auth });
  var mainFolder = await searchMainFolder(drive, folder);
  if (mainFolder.length <= 0) {
    console.error("file not found");
    process.exit(1);
  }
  let mainFolderId = mainFolder[0].id;
  await getAllRoots(drive, mainFolderId, "", false);
}

var authen = async () => {
  var apiMetaData = await loadApiMetaData();
  var credentials = apiMetaData.web;
  const oAuth2Client = new google.auth.OAuth2(
    credentials.client_id, credentials.client_secret, credentials.redirect_uris[0]);
  return await getCredentials(oAuth2Client);
}

var loadApiMetaData = async () => {
  return new Promise((resolve, reject) => {
    fs.readFile('./keys.json', async (err, content) => {
      if (err) return reject('Error loading client secret file:', err);
      return resolve(JSON.parse(content));
    });
  });
}

var getCredentials = async (oAuth2Client) => {
  return new Promise((resolve, reject) => {
    fs.readFile(TOKEN_PATH, async (err, token) => {
      if (err) {
        let token = await getAccessToken(oAuth2Client);
        return resolve(token);
      }
      oAuth2Client.setCredentials(JSON.parse(token));
      return resolve(oAuth2Client);
    });
  });
}

var getAccessToken = async (oAuth2Client) => {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
  });
  console.log('Authorize this app by visiting this url:', authUrl);
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve, reject) => {
    rl.question('Enter the code from that page here: ', (code) => {
      rl.close();
      oAuth2Client.getToken(code, (err, token) => {
        if (err) {
          return reject(err);
        }
        oAuth2Client.setCredentials(token);
        fs.writeFile(TOKEN_PATH, JSON.stringify(token), (err) => {
          if (err) return reject(err);
          console.log('Token stored to', TOKEN_PATH);
        });
        return resolve(oAuth2Client);
      });
    });
  });
}

var searchMainFolder = async (drive, folderName) => {
  var pageToken = null;
  return new Promise((resolve, reject) => {
    drive.files.list({
      q: `name='${folderName}'`,
      fields: 'nextPageToken, files(id, name)',
      spaces: 'drive',
      pageToken: pageToken
    }, (err, res) => {
      if (err) {
        console.error(err);
        return reject(err);
      } else {
        return resolve(res.data.files)
        pageToken = res.nextPageToken;
      }
    });
  });
}

var getAllRoots = async (drive, folderId, path, is_replace) => {
  var files = await searchFilesInFolder(drive, folderId);
  if (files.length > 0) {
    await fs.ensureDir(path);
    for (var i = 0; i < files.length; i++) {
      var id = files[i].id;
      var name = files[i].name;
      var replace = false;
      if(name.slice(-2) == "__"){
        replace = true;
        name = files[i].name.replace("__", "");
      }
      await getAllRoots(drive, id, `${path}/${name}`, replace);
    }
  } else if (files.length == 0) {
    console.log(path);
    var download_data = await download(drive, folderId, path);
    var dataStr = "";
    if (fs.existsSync(path)){
      await fs.copy(path, `${path}.${moment().format('DD-MM-YYYY_h:mm')}`);
    }
    if (fs.existsSync(path) && is_replace) {
      dataStr = await getExistFileData(path, download_data);
    } else {
      dataStr = download_data;
      if(is_replace){
        var begin = "# - begin -";
        var end = "# - end -";
        dataStr = `${begin}\n${dataStr}\n${end}\n`;
      }
    }
    await fs.writeFile(path, dataStr);
  } else {
  }
}

var getExistFileData = async (path, download_data) => {
  return new Promise((resolve, reject) => {
    fs.readFile(path,(err, data) => {
      if (err) return reject(err);
      else {
        var begin = "# - begin -";
        var end = "# - end -";
        var dataStr = `${data.toString()}`;
        if (dataStr.indexOf(begin) < 0) {
          dataStr = `${dataStr}\n${begin}\n${download_data}\n${end}\n`;
        } else {
          dataStr = dataStr.replace(dataStr.substring(dataStr.indexOf(begin), dataStr.indexOf(end) + end.length), `${begin}\n${download_data}\n${end}\n`);
        }
        return resolve(dataStr);
      }
    });
  });
}

var searchFilesInFolder = async (drive, folderId) => {
  pageToken = null;
  return new Promise((resolve, reject) => {
    drive.files.list({
      q: `'${folderId}' in parents`,
      fields: 'nextPageToken, files(id, name)',
      spaces: 'drive',
      pageToken: pageToken
    }, (err, res) => {
      if (err) {
        console.error(err);
        return reject(err);
      } else {
        return resolve(res.data.files)
        pageToken = res.nextPageToken;
      }
    });
  });
}

var download = async (drive, fileId, path) => {
  return new Promise((resolve, reject) => {
    drive.files.get({
      fileId: fileId,
      alt: "media"
    }, {
        responseType: 'stream'
      }, (err, response) => {
        if (err) {
          console.log(err);
          return reject(err);
        }
        var chunks = [];
        response.data.on('error', err => {
          console.log(err);
          return reject(err);
        }).on('data', (data) => {
          chunks.push(data);
        }).on('end', () => {
          return resolve(Buffer.concat(chunks).toString());
        });
      });
  });
}

module.exports = main;