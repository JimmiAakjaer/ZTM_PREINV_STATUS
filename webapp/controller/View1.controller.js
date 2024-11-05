sap.ui.define(
  [
    "sap/ui/core/mvc/Controller",
    "sap/ui/core/Fragment",
    "sap/m/MessageBox",
    "sap/m/PDFViewer",
    "../libs/jszip",
    "../libs/xlsx",
    "sap/ui/export/library",
    "sap/ui/export/Spreadsheet",
    "sap/ui/model/type/Float",
  ],
  function(
    Controller,
    Fragment,
    MessageBox,
    PDFViewer,
    jszip,
    xlsxjs,
    library,
    Spreadsheet,
    Float
  ) {
    "use strict";

    return Controller.extend("ZTM_PREINV_STATUS.controller.View1", {
      excelSheetsData: [],
      pDialog: null,

      onInit: function() {
        this._oModel = this.getOwnerComponent().getModel();
        this.getView().setModel(this._oModel);
      },
      openExcelUploadDialog: function(oEvent) {
        this.excelSheetsData = [];
        var oView = this.getView();
        if (!this.pDialog) {
          Fragment.load({
            id: "excel_upload",
            name: "ZTM_PREINV_STATUS.view.ExcelUpload",
            type: "XML",
            controller: this,
          })
            .then((oDialog) => {
              var oFileUploader = Fragment.byId("excel_upload", "uploadSet");
              oFileUploader.removeAllItems();
              this.pDialog = oDialog;
              this.pDialog.open();
            })
            .catch((error) => alert(error.message));
        } else {
          var oFileUploader = Fragment.byId("excel_upload", "uploadSet");
          oFileUploader.removeAllItems();
          this.pDialog.open();
        }
      },
      handleTypeMissmatch: function(oEvent) {
        var aFileTypes = oEvent.getSource().getFileType();
        aFileTypes.map(function(sType) {
          return "*." + sType;
        });
        MessageBox.error(
          "The file type *." +
            oEvent.getParameter("fileType") +
            " is not supported. Choose one of the following types: " +
            aFileTypes.join(", ")
        );
      },
      onRefresh: function(oEvent) {
        var oModel = this.getView().getModel();
        var oSmartTable = this.getView().byId("table001");
        oSmartTable.rebindTable();
        oModel.refresh();
      },
      onPrint: function(oEvent) {
        var that = this,
          oModel = this.getView().getModel(),
          oTable = this.byId("table001").getTable(),
          aSelectedIndices = oTable.getSelectedIndices(),
          aAllItems = [];

        // Check if there are any selected indices
        if (aSelectedIndices.length === 0) {
          MessageBox.error("Select at least one line");
          return;
        }

        // Load all items from the table using a Promise
        var allItemsPromise = new Promise(function(resolve, reject) {
          var oBinding = oTable.getBinding("rows");
          oBinding.getModel().read(oBinding.getPath(), {
            success: function(oData) {
              resolve(oData.results); // Populate aAllItems with loaded data
            },
            error: function() {
              MessageBox.error("Error loading data :(");
              reject();
            },
          });
        });

        // Validate TspId
        var tspIdValidationPromise = new Promise(function(resolve, reject) {
          oModel.read("/TspValidationSet", {
            method: "GET",
            success: function(oData) {
              var TspIdNotPrint = false;

              aSelectedIndices.forEach(function(index) {
                var oObject = aAllItems[index];
                // Check if the TspId of the selected object is present in validation data
                for (var i = 0; i < oData.results.length; i++) {
                  if (oData.results[i].TspId === oObject.TspId) {
                    TspIdNotPrint = true;
                    break;
                  }
                }
              });
              resolve(TspIdNotPrint);
            },
            error: function(oError) {
              MessageBox.error("Error on Validation oData");
              resolve(true);
            },
          });
        });

        // After loading data and validating TspId
        allItemsPromise
          .then(function(allItems) {
            aAllItems = allItems; // Set aAllItems with loaded data

            return tspIdValidationPromise;
          })
          .then(function(TspIdNotPrint) {
            // Check if TspId is not allowed to print
            if (TspIdNotPrint) {
              MessageBox.error(
                "There is a carrier that cannot be printed, please check the selected lines"
              );
              return;
            }

            // Check if Lifecycle is '06-Canceled'
            var lifecycle06Exists = aSelectedIndices.some(function(index) {
              var oObject = aAllItems[index];
              return oObject.Lifecycle === "06-Canceled";
            });

            if (lifecycle06Exists) {
              MessageBox.error(
                "It is not possible to print canceled documents, please check the selected documents"
              );
              return;
            }

            // Check if PrintStatus is 'Printed'
            var printStatusBExists = aSelectedIndices.some(function(index) {
              var oObject = aAllItems[index];
              return oObject.PrintStatus === "Printed";
            });

            // Confirm reprint if PrintStatus is 'Printed'
            if (printStatusBExists) {
              MessageBox.confirm(
                "Some FSD documents have already been printed, do you want to continue?",
                {
                  title: "Confirmation: Reprint?",
                  onClose: function(oAction) {
                    if (oAction === MessageBox.Action.OK) {
                      that._printSelectedItems(aAllItems, aSelectedIndices);
                    }
                  },
                }
              );
            } else {
              that._printSelectedItems(aAllItems, aSelectedIndices);
            }

            // Call this.onRefresh() after a short delay to ensure table is updated
            setTimeout(function() {
              that.onRefresh();
            }, 4000);
          })
          .catch(function(error) {
            MessageBox.error(error);
          });
      },
      _printSelectedItems: function(gettingAllRows, aSelectedIndices) {
        var that = this;
        var oModel = this.getView().getModel();
        var aSelectedItems = [];

        aSelectedIndices.forEach(function(index) {
          if (index >= 0 && index < gettingAllRows.length) {
            var row = gettingAllRows[index];
            var sfirId = row.SfirId;
            if (sfirId) {
              aSelectedItems.push(sfirId);
            }
          }
        });

        if (aSelectedItems.length > 0) {
          var concatenatedSfirIds = aSelectedItems.join(",");
          var opdfViewer = new PDFViewer();
          that.getView().addDependent(opdfViewer);
          var sServiceURL = oModel.sServiceUrl;
          var sSource =
            sServiceURL +
            "/PrintSet(SfirId='" +
            concatenatedSfirIds +
            "')/$value";
          opdfViewer.setSource(sSource);
          opdfViewer.setTitle("PreInvoice PDF");
          opdfViewer.open();
        } else {
          MessageBox.error("Select at least one line");
        }
      },
      onArchive: function(oEvent) {
        var that = this,
          oModel = this.getView().getModel(),
          oTable = this.byId("table001").getTable(),
          aSelectedIndices = oTable.getSelectedIndices();

        // Checking related indexes
        if (aSelectedIndices.length === 0) {
          MessageBox.error("Select at least one line");
          return;
        }

        // Charged data on Promise
        var loadAllItems = new Promise(function(resolve, reject) {
          var oBinding = oTable.getBinding("rows");

          oBinding.getModel().read(oBinding.getPath(), {
            success: function(oData) {
              resolve(oData.results);
            },
            error: function() {
              MessageBox.error("Error loading data :(");
              reject();
            },
          });
        });

        // Let's process Archive!
        loadAllItems
          .then(function(aAllItems) {
            // Lifecycle = '06-Canceled'?
            var lifecycle06Exists = aSelectedIndices.some(function(index) {
              var oObject = aAllItems[index];
              return oObject && oObject.Lifecycle === "06-Canceled";
            });

            if (lifecycle06Exists) {
              MessageBox.error(
                "It is not possible to Archive canceled documents, please check the selected documents"
              );
              return;
            }

            // WebarchStatus = 'Archived'?
            var WebarchStatusBExists = aSelectedIndices.some(function(index) {
              var oObject = aAllItems[index];
              return oObject && oObject.WebarchStatus === "Archived";
            });

            // Sorry already archived!
            if (WebarchStatusBExists) {
              MessageBox.error(
                "Some FSD documents have been already archived, archiving cancelled."
              );
            } else {
              that._archiveSelectedItems(aAllItems, aSelectedIndices);
            }

            // Update table with a short delay
            setTimeout(function() {
              that.onRefresh();
            }, 4000);
          })
          .catch(function() {
            // Error loading data :(
            console.log("Error loading data :(");
          });
      },
      _archiveSelectedItems: async function(gettingAllRows, aSelectedIndices) {
        var aSelectedItems = aSelectedIndices
          .filter((index) => index >= 0 && index < gettingAllRows.length)
          .map((index) => gettingAllRows[index]?.SfirId)
          .filter((sfirId) => sfirId);

        if (aSelectedItems.length > 0) {
          var sEntitySet = "/ArchiveSet";
          var sBatchGroupId = "Archive";

          var oModel = this.getOwnerComponent().getModel();
          oModel.setDefaultBindingMode(sap.ui.model.BindingMode.TwoWay);
          oModel.setUseBatch(true);
          oModel.setDeferredGroups([sBatchGroupId]);

          await Promise.all(
            aSelectedItems.map(async function(sfirId) {
              var sPath = sEntitySet + "(SfirId='" + sfirId + "')";
              var oItem = { SfirId: sfirId };
              try {
                oModel.update(sPath, oItem, { groupId: sBatchGroupId });
              } catch (error) {
                MessageBox.error(
                  "Error updating item with ID " + sfirId + ": " + error
                );
              }
            })
          );

          oModel.submitChanges({
            groupId: sBatchGroupId,
            success: function(oData, oResponse) {
              MessageBox.success("PDF was archived successfully");
            },
            error: function(oError) {
              MessageBox.error("Error Archiving data");
            },
          });
        } else {
          MessageBox.error("Select at least one line");
        }
      },
      onTempDownload: function() {
        var header = [
          { label: "FSD Type", property: "SfirType" },
          { label: "FSD Id", property: "SfirId" },
          { label: "Preinvoice Nr.", property: "Preinvoice" },
          { label: "Settlement Date", property: "FsdDate" },
          { label: "Created On", property: "CreatedOn" },
          { label: "Lifecycle", property: "Lifecycle" },
          { label: "Carrier", property: "TspId" },
          { label: "External Carrier", property: "BpExt" },
          { label: "Posting Date", property: "InvDt" },
          { label: "Net Amount", property: "NetAmount" },
          { label: "Currency", property: "DocCurrency" },
          { label: "Admin. Fee", property: "AdminFee" },
          { label: "Plan. Discount", property: "PlanDisc" },
          { label: "Excel Exported?", property: "ExportStatus" },
          { label: "Printed?", property: "PrintStatus" },
          { label: "Web Archived?", property: "WebarchStatus" },
        ];

        var aData = [{}]; // Empty data
        var oSettings = {
          workbook: { columns: header },
          dataSource: aData,
          fileName: "TM: Selfbilling Pre-invoice.xlsx",
          worker: false,
        };
        var oSheet = new sap.ui.export.Spreadsheet(oSettings);
        oSheet
          .build()
          .then(function() {
            MessageBox.success("Template Downloaded");
          })
          .finally(function() {
            oSheet.destroy();
          });
      },
      onCloseDialog: function(oEvent) {
        this.pDialog.close();
      },
      onItemRemoved: function(oEvent) {
        this.excelSheetsData = [];
      },
      onBeforeExport: function(oEvent) {
        var oSmartTable = this.byId("table001");
        var oTable = oSmartTable.getTable();
        var oBinding = oTable.getBinding("rows");

        var concatenatedValues = "";
        oBinding.getContexts().forEach(function(oContext) {
          var oItem = oContext.getObject();
          concatenatedValues += oItem.SfirId + "|" + oItem.SfirType + ",";
        });

        // Removing last comma
        concatenatedValues = concatenatedValues.slice(0, -1);

        var oModel = this.getView().getModel();
        var sServiceURL = oModel.sServiceUrl;
        var sSource =
          sServiceURL +
          "/ExcelStatusSet(Keys='" +
          concatenatedValues +
          "')/$value";

        oEvent.getParameter("exportSettings").url = sSource;
      },
      onUploadSet: function(oEvent) {
        var that = this,
          oSource = oEvent.getSource();

        // checking if excel file contains data or not
        if (!this.excelSheetsData.length) {
          MessageBox.error("Select file to Upload");
          return;
        }

        that.callOdata();
        that.pDialog.close();
      },
      onUploadSetComplete: function(oEvent) {
        var oFileUploader = Fragment.byId("excel_upload", "uploadSet");
        var oFile = oFileUploader.getItems()[0].getFileObject();
        var reader = new FileReader();
        var that = this;

        reader.onload = (e) => {
          let xlsx_content = e.currentTarget.result;

          let workbook = XLSX.read(xlsx_content, { type: "binary" });
          var excelData = XLSX.utils.sheet_to_row_object_array(
            workbook.Sheets["Sheet1"]
          );

          workbook.SheetNames.forEach(function(sheetName) {
            that.excelSheetsData.push(
              XLSX.utils.sheet_to_row_object_array(workbook.Sheets[sheetName])
            );
          });
        };
        reader.readAsBinaryString(oFile);
      },
      callOdata: function() {
        var oModel = this.getView().getModel();
        var payload = {};

        this.excelSheetsData[0].forEach((value, index) => {
          // setting the payload data
          payload = {
            PREINVOICE: [
              {
                SFIR_TYPE: value["FSD Type"],
                SFIR_ID: value["FSD Id"],
                PREINVOICE: value["Preinvoice Nr."],
                FSD_DATE: value["Settlement Date"],
                CREATED_ON: value["Created On"],
                LIFECYCLE: value["Lifecycle"],
                TSP_ID: value["Carrier"],
                BPEXT: value["External Carrier"],
                INV_DT: value["Posting Date"],
                NET_AMOUNT: value["Net Amount"],
                DOC_CURRENCY: value["Currency"],
                ADMIN_FEE: value["Admin. Fee"],
                PLAN_DISC: value["Plan. Discount"],
                EXPORT_STATUS: value["Excel Exported?"],
                PRINT_STATUS: value["Printed?"],
                WEBARCH_STATUS: value["Web Archived?"],
              },
            ],
          };
          // setting excel file row number for identifying the exact row in case of error or success
          payload.ExcelRowNumber = index + 1;
          // calling the odata service
          oModel.create("/UploadSet", payload, {
            success: (result) => {
              var oMessageManager = sap.ui.getCore().getMessageManager();
              var oMessage = new sap.ui.core.message.Message({
                message: "Building Created/Updated with ID: " + result.SfirId,
                persistent: true, // create message as transition message
                type: sap.ui.core.MessageType.Success,
              });
              oMessageManager.addMessages(oMessage);
            },
            error: (result) => {
              MessageBox.error("Error processing data");
            },
          });
        });
      },
      onEdit: function() {
        var oSmartTable = this.getView().byId("table001");
        var oTable = oSmartTable.getTable();
        var aColumns = oTable.getColumns();
        var oViewModel = this.getView().getModel("view");

        if (!oViewModel) {
          oViewModel = new sap.ui.model.json.JSONModel();
          this.getView().setModel(oViewModel, "view");
          oViewModel.setProperty("/editMode", false);
        }

        var bEditMode = oViewModel.getProperty("/editMode");
        oViewModel.setProperty("/editMode", !bEditMode);

        var oButton = this.getView().byId("editButton");
        if (bEditMode) {
          oButton.setIcon("sap-icon://edit");
        } else {
          oButton.setIcon("sap-icon://display");
        }

        aColumns.forEach(function(oColumn) {
          if (oColumn.getLabel().getText() === "Preinvoice Nr.") {
            oColumn.setTemplate(
              new sap.m.Input({
                value: "{Preinvoice}",
                editable: !oColumn.getTemplate().getEditable(),
              })
            );
          }
          if (oColumn.getLabel().getText() === "Settlement Date") {
            oColumn.setTemplate(
              new sap.m.Input({
                value: "{FsdDate}",
                editable: !oColumn.getTemplate().getEditable(),
              })
            );
          }
        });
        oTable.invalidate();
      },
      onSave: async function(oEvent) {
        var oSmartTable = this.byId("table001");
        var oTable = oSmartTable.getTable();
        var oBinding = oTable.getRows();
        var hasError = false;
        var sBatchGroupId = "Save";

        var oModel = new sap.ui.model.odata.v2.ODataModel(
          this.getOwnerComponent()._mManifestModels[""].sServiceUrl,
          true
        );
        oModel.setDefaultBindingMode(sap.ui.model.BindingMode.TwoWay);
        oModel.setUseBatch(true);
        oModel.setDeferredGroups([sBatchGroupId]);

        await Promise.all(
          oBinding.map(async function(oContext) {
            let sPath = oContext.getBindingContext().getPath();
            let oItem = oContext.getBindingContext().getObject();
            let fsdDate = oItem.FsdDate;

            if (fsdDate) {
              var dateRegex = /^(0[1-9]|[12][0-9]|3[01])\/(0[1-9]|1[0-2])\/\d{4}$/;
              if (!dateRegex.test(fsdDate)) {
                MessageBox.error(
                  "The FSD Id " +
                    oItem.SfirId +
                    " has an invalid format. Please use DD/MM/YYYY on Settlement Date."
                );
                hasError = true;
              } else {
                oModel.update(sPath, oItem, { groupId: sBatchGroupId });
              }
            }
          })
        );

        if (!hasError) {
          oModel.submitChanges({
            groupId: sBatchGroupId,
            success: function(oData, oResponse) {
              MessageBox.success("Changes successfully submitted");
            },
            error: function(oError) {
              MessageBox.error("Error submitting changes");
            },
          });
        }
      },
    });
  }
);
