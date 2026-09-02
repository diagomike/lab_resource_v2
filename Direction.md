one thing I would like to add is the customization levels and different views of this same data-table&#x20;
when I integrate later I would like to add

1\. User based access limits to a filtered set (so when a custodian, logs in, he gets data with filtered by Custodian is X; so that he sees only the things he manages, and a Department Head gets filters applied with Owned by Department X, (We will have a view where departments, staff, students, custodians can search for things across the university - there will be a page of all view only access for that but when it comes to managing; I want admin to create a create category like thing where Admin can create views; and then he can give personnel types specific views; so he defines views for custodians, department heads, college deans which get filters of all departments under them); and then also the offices which might get all data or a certain filter applied

2\. Approval Chain types also shall be setup by the Admin; and he can assign them to all kinds of Data Alteration Capabilities; for example

&#x20;  1\. to make name change what approval chain it must go through in the approvals tab; this will later be delegated by personnel, and their specific offices login so a Custodian would set a Status change to broken; then the Department head must approve for that CRUD op to go through;
&#x20;  2\. if it is an Add Request - then Department Head --> College Dean --> AVP --> Procurement Office; then the Custodian himself -- only then would the add Request go through; and this should be different for Object types - like for consumables- it might not be so not need those levels; just a confirm modal would be enough


I also want to replace all Emoji with Official Icons from a selected Icon library of your choice - this is a professional build; we don't do emojis
also merge the Expand and Collapse buttons into a single toggle button like the dark/light mode switches; I don't also see the differnece between the rolled up vs tree view - if there is a difference explain it to me or else just drop the rolled up

so at the end of this build I would expect a side-bar in which I can toggle user accounts; as though I am loggin in with different accounts - and with the admin - I can do&#x20;
\- Access level filter setup for Target User Types; or Specific Personnel - determining what level of the data-table they can view
\- Approval Chain setup for Target User Types on specific object types like Department head can create labs, procurement office can create things into store. Custodian can update consumable status without approval, or update constant item status with Department head approval. and so on

then this view change and approval network should reflect on the dropdown switched other accounts - this will be perfect to migrate to lab\_resources\_v2 repo

please note that this Personnel access and Org structure based example should be implemented in this single app

lets make sure you understand my desires and that we are on the same page - you can grill me with questions and lets build an implementation plan